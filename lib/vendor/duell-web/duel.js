/* Agent duels: pure logic (no DOM). Same two agents + same seed = same match on both phones. */
(function (root) {
  "use strict";
  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./core.js") : root.DuellCore;
  var E = node ? require("./engine.js") : root.DuellEngine;
  var DATA = node ? require("./duel.json") : root.DuelData;
  var MODES = ["rps", "mind", "rap", "auction", "flappy", "deck"];
  var SLIDERS = { rps: ["r", "c", "p"], mind: ["c"], rap: ["r", "c", "p"], auction: ["r", "c", "p"], flappy: ["r", "p"], deck: [] };
  var ROUNDS = { rps: 9, mind: 10, rap: 4, auction: 4 };
  var HANDS = 3, FLY_CAP = 40, MAX_TICKS = 120 * 90;

  function clean(s, max) {
    var t = Array.from(String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
    return t && C.isClean(t) ? t : "";
  }
  function slider(v, d) { return Math.round(C.clampNum(v, 0, 100, d)); }
  function sanitizeAgent(a, fallback) {
    a = a && typeof a === "object" ? a : {};
    var f = fallback || {};
    return { n: C.sanitizeName(a.n) || f.n || "", e: typeof a.e === "string" ? C.sanitizeEmoji(a.e) : (f.e || "🤖"), r: slider(a.r, f.r == null ? 50 : f.r), c: slider(a.c, f.c == null ? 50 : f.c), p: slider(a.p, f.p == null ? 50 : f.p) };
  }
  function sanitize(o, d) {
    d.m = MODES.indexOf(o.m) >= 0 ? o.m : "rps";
    d.a = sanitizeAgent(o.a); d.b = sanitizeAgent(o.b);
    d.seed = Math.floor(C.clampNum(o.seed, 0, 4294967295, 1));
    d.set = Math.floor(C.clampNum(o.set, 0, DATA.sets.length - 1, 0));
    d.w = clean(o.w, 14);                     // rap word or auction item, always the player's own
    d.ch = o.ch === 1 ? 1 : 0;                // 1: this link is a challenge, my agent becomes the rival
    if (d.m === "flappy") { var g = C.sanitizeState({ v: 1, seed: d.seed, params: o.g && o.g.params, theme: o.g && o.g.theme }); d.g = { params: g.params, theme: g.theme }; }
    return d;
  }
  function fromIdea(idea, profile, lang, base) {
    var L = idea[lang] || idea.de, x = idea.duel;
    base.m = x.mode; base.seed = C.hash32("duel-" + idea.id); base.set = x.set || 0; base.w = L.w || "";
    base.a = Object.assign({ n: profile.nick, e: profile.emoji }, x.a);
    base.b = Object.assign({ n: L.rival, e: x.e || "🤖" }, x.b);
    if (x.mode === "flappy") base.g = x.game;
    return base;
  }

  // Both phones sort the agents the same way, so the match does not depend on who started it.
  function canonical(a, b) { return JSON.stringify(a) <= JSON.stringify(b); }
  function rngFor(doc) { var x = canonical(doc.a, doc.b) ? [doc.a, doc.b] : [doc.b, doc.a]; return C.mulberry32(C.hash32("duel|" + doc.m + "|" + doc.seed + "|" + (doc.w || "") + "|" + JSON.stringify(x))); }
  function beats(x, y) { return (x + 2) % HANDS === y; }       // 0 beats 2, 1 beats 0, 2 beats 1
  function outcome(x, y) { return x === y ? 0 : beats(x, y) ? 1 : -1; }

  // Courage leans to the first hand, cheek repeats a win, patience counters the other side's last hand.
  function hand(ag, me, foe, rnd) {
    var last = me.length - 1;
    if (last >= 0 && rnd() < ag.p / 130) return (foe[last] + 1) % HANDS;
    if (last >= 0 && outcome(me[last], foe[last]) > 0 && rnd() < ag.c / 110) return me[last];
    var x = rnd(), lead = 1 / 3 + (ag.r / 100) * 0.5;
    return x < lead ? 0 : x < lead + (1 - lead) / 2 ? 1 : 2;
  }
  function playRps(doc, rnd) {
    var ah = [], bh = [], out = [], sa = 0, sb = 0, flip = !canonical(doc.a, doc.b);
    for (var i = 0; i < ROUNDS.rps; i++) {
      var first = rnd(), second = rnd(), x = hand(doc.a, ah, bh, seq(flip ? second : first)), y = hand(doc.b, bh, ah, seq(flip ? first : second)), o = outcome(x, y);
      ah.push(x); bh.push(y); if (o > 0) sa++; else if (o < 0) sb++;
      out.push({ x: x, y: y, o: o, sa: sa, sb: sb });
    }
    return { rounds: out, sa: sa, sb: sb };
  }
  // A stream from one number, so each agent draws the same values however many it needs: the seat does not matter.
  function seq(v) { var r = C.mulberry32(Math.floor(v * 4294967295)); return r; }

  function pick(list, rnd) { return list[Math.floor(rnd() * list.length)]; }
  function fill(s, ag, doc) { return s.replace(/\{w\}/g, doc.w || "").replace(/\{n\}/g, ag.n || ag.e); }
  function rapLine(ag, foe, doc, rnd, lang) {
    var T = DATA.rap[lang] || DATA.rap.de, x = rnd(), kind = x < ag.c / (ag.c + ag.p + 1) ? "boast" : "calm", list = doc.w ? T[kind].concat(T.word) : T[kind];
    var base = 3 + Math.floor(rnd() * (2 + (ag.r / 100) * 7)), pat = ag.p > 60 ? 1 : 0, bon = 0;
    if (kind === "boast" && foe.p < 40) bon++;       // cheek lands best on an impatient rival
    if (kind === "calm" && foe.c > 60) bon++;        // staying calm answers cheek
    return { text: fill(pick(list, rnd), ag, doc), pts: base + pat + bon, base: base, pat: pat, bon: bon };
  }
  function playRap(doc, rnd, lang) {
    var out = [], sa = 0, sb = 0, flip = !canonical(doc.a, doc.b);
    for (var i = 0; i < ROUNDS.rap; i++) {
      var p = rapLine(flip ? doc.b : doc.a, flip ? doc.a : doc.b, doc, rnd, lang), q = rapLine(flip ? doc.a : doc.b, flip ? doc.b : doc.a, doc, rnd, lang), l = flip ? q : p, m = flip ? p : q;
      sa += l.pts; sb += m.pts; out.push({ x: l, y: m, sa: sa, sb: sb });
    }
    return { rounds: out, sa: sa, sb: sb };
  }
  function bidFor(ag, value, left, rest, rnd) {
    var keep = (ag.p / 100) * (rest - 1) * 8;                       // patience keeps money for later items
    var raw = value * (0.45 + (ag.r / 100) * 0.9) + (rnd() < ag.c / 200 ? 8 : 0);  // cheek sometimes overbids to scare
    return Math.max(0, Math.min(left, Math.round(Math.min(raw, left - keep))));
  }
  function playAuction(doc, rnd, lang) {
    var flip = !canonical(doc.a, doc.b), left = [100, 100], gain = [0, 0], out = [], items = (DATA.items[lang] || DATA.items.de).slice(), list = [];
    while (list.length < ROUNDS.auction) list.push(items.splice(Math.floor(rnd() * items.length), 1)[0]);
    if (doc.w) list[0] = doc.w;
    list.forEach(function (item, i) {
      var who = flip ? [doc.b, doc.a] : [doc.a, doc.b], vals = [20 + Math.floor(rnd() * 41), 20 + Math.floor(rnd() * 41)];
      var bids = [bidFor(who[0], vals[0], left[0], list.length - i, rnd), bidFor(who[1], vals[1], left[1], list.length - i, rnd)];
      var win = bids[0] === bids[1] ? -1 : bids[0] > bids[1] ? 0 : 1;
      if (win >= 0) { left[win] -= bids[win]; gain[win] += vals[win] - bids[win]; }   // the winner pays the own bid: too much courage overpays
      var A = flip ? 1 : 0, B = 1 - A;
      out.push({ item: item, ba: bids[A], bb: bids[B], va: vals[A], vb: vals[B], o: win < 0 ? 0 : win === A ? 1 : -1, sa: gain[A], sb: gain[B], la: left[A], lb: left[B] });
    });
    return { rounds: out, sa: out[out.length - 1].sa, sb: out[out.length - 1].sb };
  }

  // ---------- flying: one rule, flap when below the line through the next gap ----------
  function flyLine(ag) { return (ag.r - 50) * 0.9; }             // courage: how close to the lower pipe it dares to fly
  function flyStep(sim, ag, rnd) {
    if (sim.state === "ready") sim.flap();
    var next = null, i;
    for (i = 0; i < sim.pipes.length; i++) if (sim.pipes[i].x + E.PIPE_W > E.BX - E.R) { next = sim.pipes[i]; break; }
    var mid = next ? next.top + sim.params.gap / 2 : E.H * 0.42, jitter = (rnd() - 0.5) * (100 - ag.p) * 0.45;
    if (sim.bird.y > mid + flyLine(ag) + jitter && sim.bird.vy >= 0) sim.flap();
    return sim.step();
  }
  function flySim(doc) { return E.createSim(doc.g.params, C.mulberry32(doc.seed)); }
  function flyRnd(ag) { return C.mulberry32(C.hash32("fly|" + JSON.stringify(ag))); }
  function fly(doc, ag) {
    var sim = flySim(doc), rnd = flyRnd(ag);
    while (sim.state !== "over" && sim.score < FLY_CAP && sim.ticks < MAX_TICKS) flyStep(sim, ag, rnd);
    return sim.score;
  }
  // From a real training flight: where the player tends to flap, measured against the middle of the next gap.
  function learnFlap(samples) {
    var s = (Array.isArray(samples) ? samples : []).filter(function (x) { return typeof x === "number" && isFinite(x); });
    if (s.length < 3) return null;
    var mean = s.reduce(function (a, b) { return a + b; }, 0) / s.length;
    var sd = Math.sqrt(s.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / s.length);
    return { r: slider(50 + mean / 0.9, 50), p: slider(100 - sd * 2, 50) };
  }

  // ---------- the player against their own agent: it counts what usually follows what ----------
  function predict(history, sharp) {
    var n = history.length, counts = [1, 1, 1], i;
    if (n) for (i = 1; i < n; i++) if (history[i - 1] === history[n - 1]) counts[history[i]] += 2;
    for (i = 0; i < n; i++) counts[history[i]] += 0.25;
    var best = counts.indexOf(Math.max.apply(null, counts));
    return { guess: best, confident: sharp / 100 };
  }
  function mindHand(history, sharp, v) {
    var p = predict(history, sharp);
    return v < p.confident ? (p.guess + 1) % HANDS : Math.floor(v * 1000) % HANDS;
  }

  function play(doc, lang) {
    var rnd = rngFor(doc), m = doc.m, L = lang === "en" ? "en" : "de";
    if (m === "rps") return playRps(doc, rnd);
    if (m === "rap") return playRap(doc, rnd, L);
    if (m === "auction") return playAuction(doc, rnd, L);
    if (m === "flappy") { var a = fly(doc, doc.a), b = fly(doc, doc.b); return { rounds: [], sa: a, sb: b }; }
    return { rounds: [], sa: 0, sb: 0 };
  }
  function winner(res) { return res.sa === res.sb ? 0 : res.sa > res.sb ? 1 : -1; }

  // ---------- after the match: why it ended like this, read from the match itself and the sliders, no AI ----------
  // -> { k: reason, w: "a"|"b" (winner, "" on a draw), v: numbers for the sentence, tip: what the loser could change }
  // or null where nothing can be said (mind, deck). Ties between reasons go to the one listed first.
  function explain(doc, res) {
    var w = winner(res), W = w > 0 ? "a" : w < 0 ? "b" : "", Lo = W === "a" ? "b" : W === "b" ? "a" : "", m = doc.m, R = res.rounds || [];
    function out(k, v, tip) { return { k: k, w: W, v: Object.assign({ a: res.sa, b: res.sb }, v || {}), tip: W ? tip || null : null }; }
    function best(list) { var top = null; list.forEach(function (c) { if (c[1] > 0 && (!top || c[1] > top[1])) top = c; }); return top; }
    if (!W && m !== "flappy") return out("draw");
    if (m === "rps") {
      var me = function (r) { return Lo === "a" ? r.x : r.y; }, foe = function (r) { return Lo === "a" ? r.y : r.x; }, lost = function (r) { return Lo === "a" ? r.o < 0 : r.o > 0; };
      var counter = 0, again = 0, lead = 0, L = doc[Lo], Wg = doc[W];
      R.forEach(function (r, i) {
        if (me(r) === 0) lead++;
        if (!i || !lost(r)) return;
        var p = R[i - 1];
        if (foe(r) === (me(p) + 1) % HANDS) counter++;
        if (me(r) === me(p) && (Lo === "a" ? p.o > 0 : p.o < 0)) again++;
      });
      var top = best([["rpsCounter", counter, { n: counter, p: Wg.p }, "tipCounter"], ["rpsRepeat", again, { n: again, c: L.c }, "tipRepeat"],
        ["rpsLead", lead >= 5 ? lead : 0, { n: lead, h: 0, r: L.r }, "tipLead"]]);
      return top ? out(top[0], top[2], top[3]) : out("luck");
    }
    if (m === "rap") {
      var sum = function (side, f) { return R.reduce(function (s, r) { return s + r[side][f]; }, 0); }, ws = W === "a" ? "x" : "y", ls = W === "a" ? "y" : "x";
      var t2 = best([["rapCourage", sum(ws, "base") - sum(ls, "base"), { r: doc[W].r, s: doc[Lo].r }, "tipCourage"], ["rapPatience", sum(ws, "pat") - sum(ls, "pat"), { p: doc[W].p }, "tipPatience"],
        ["rapCounter", sum(ws, "bon") - sum(ls, "bon"), { n: sum(ws, "bon") }, "tipCheek"]]);
      return t2 ? out(t2[0], t2[2], t2[3]) : out("luck");
    }
    if (m === "auction") {
      var lw = Lo === "a" ? 1 : -1, over = R.filter(function (r) { return r.o === lw && (Lo === "a" ? r.ba > r.va : r.bb > r.vb); }).length;
      var left = R.length ? (Lo === "a" ? R[R.length - 1].la : R[R.length - 1].lb) : 0;
      var got = function (o) { return R.filter(function (r) { return r.o === o; }).length; };
      if (over) return out("aucOver", { n: over, r: doc[Lo].r }, "tipOver");
      if (left >= 30) return out("aucLeft", { m: left, p: doc[Lo].p }, "tipLeft");
      return out("aucFew", { k: got(-lw), j: got(lw) }, "tipFew");
    }
    if (m === "flappy") {
      if (!W) return out("draw");
      var ls2 = doc[Lo], ws2 = doc[W], n = (Lo === "a" ? res.sa : res.sb) + 1;
      if (ls2.p + 10 <= ws2.p) return out("flyShaky", { p: ls2.p, n: n }, "tipShaky");
      if (Math.abs(ls2.r - 50) >= Math.abs(ws2.r - 50) + 10) return out("flyClose", { r: ls2.r, n: n }, "tipClose");
      return out("flyLuck", { n: n, m: (W === "a" ? res.sa : res.sb) + 1 });
    }
    return null;
  }
  function strings() {
    var out = [];
    (function walk(v) { if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.keys(v).forEach(function (k) { walk(v[k]); }); })(DATA);
    return out;
  }

  var api = {
    MODES: MODES, SLIDERS: SLIDERS, ROUNDS: ROUNDS, FLY_CAP: FLY_CAP, DATA: DATA, sanitize: sanitize, sanitizeAgent: sanitizeAgent, fromIdea: fromIdea,
    play: play, winner: winner, explain: explain, outcome: outcome, fly: fly, flySim: flySim, flyRnd: flyRnd, flyStep: flyStep, flyLine: flyLine, learnFlap: learnFlap, predict: predict, mindHand: mindHand, strings: strings
  };
  if (node) module.exports = api; else root.Duel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
