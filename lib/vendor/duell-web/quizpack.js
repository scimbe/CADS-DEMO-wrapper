// The shared quiz engine: one question pack (from a night pack, a topic or the person's own text) for the cards Frag mich
// ab, Lücke, Wörter, Schätzen, the Team-Quiz and the Typen-Quiz. Pure logic (no DOM). The pack travels in the link
// (doc.pk) next to the moves, so nobody's server keeps it. Numbers are never computed by a model: a Schätzen number is an
// answer as it stands (digits only), the slider's end is computed here from the seed.
(function (root) {
  "use strict";
  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./core.js") : root.DuellCore;
  var DATA = node ? require("./turn.json") : root.TurnData;
  // Pack in the link: t title, m mode (l learning, f company: alone and without ranking, g group: strengths only),
  // q [[question, answer, wrong, wrong, wrong?]] or for g [[question, [text, type], ...]], z a whole number per question
  // or 0 (Schätzen), y [[type, strength]] for g. Short caps: the whole sheet fits into one link (core.js MAX_FRAGMENT).
  var MODES = { lernen: "l", firma: "f", gruppe: "g" }, MAX_Q = 8, MIN_Q = 3, F = 120, A = 60, ZMAX = 999999;
  var GAMES = { abfragen: 1, luecke: 1, woerter: 1, schaetzen: 1, quiz: 1, typen: 1 };
  function T(lang) { return C.textsFor(DATA.text, lang); }
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k]; }); }
  function txt(v, max) {
    var s = Array.from(String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
    return s && C.isClean(s) && !/https?:|www\.|:\/\//i.test(s) ? s : "";
  }
  function fold(s) { return String(s).toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, ""); }
  // "8", "1.000", "4 000" -> 8, 1000, 4000; anything with a unit, a comma, a leading zero ("007") or more than one number
  // is not a Schätzen answer
  function whole(a) { var s = String(a).trim(); if (!/^[1-9]\d{0,2}([. ]\d{3})*$|^[1-9]\d{0,5}$/.test(s)) return 0; var n = Number(s.replace(/[. ]/g, "")); return n >= 2 && n <= ZMAX ? n : 0; }
  // A pack from the link, or null. Every text through the word list; a question whose answers are not all different goes.
  function sanitize(o) {
    if (!o || typeof o !== "object" || ["l", "f", "g"].indexOf(o.m) < 0 || !Array.isArray(o.q)) return null;
    var t = txt(o.t, 40), p = { t: t, m: o.m, q: [] };
    if (!t) return null;
    if (o.m === "g") {
      p.y = (Array.isArray(o.y) ? o.y : []).slice(0, 4).map(function (y) { return Array.isArray(y) ? [txt(y[0], 26), txt(y[1], 90)] : null; }).filter(function (y) { return y && y[0] && y[1]; });
      if (p.y.length < 2) return null;
      o.q.slice(0, MAX_Q).forEach(function (q) {
        if (!Array.isArray(q)) return;
        var f = txt(q[0], F), as = q.slice(1, 5).map(function (a) { return Array.isArray(a) && Number.isInteger(a[1]) && a[1] >= 0 && a[1] < p.y.length ? [txt(a[0], 56), a[1]] : null; }).filter(function (a) { return a && a[0]; });
        if (f && as.length >= 2 && new Set(as.map(function (a) { return fold(a[0]); })).size === as.length) p.q.push([f].concat(as));
      });
    } else {
      var z = [];
      o.q.slice(0, MAX_Q).forEach(function (q, i) {
        if (!Array.isArray(q)) return;
        var row = [txt(q[0], F)].concat(q.slice(1, 5).map(function (a) { return txt(a, A); }).filter(Boolean));
        // the answer alone (Frag mich ab, Wörter, Schätzen need no wrong ones) or with two or three wrong ones
        if (!row[0] || row.length === 3 || row.length < 2 || new Set(row.slice(1).map(fold)).size !== row.length - 1) return;
        p.q.push(row);
        var n = Array.isArray(o.z) ? o.z[i] : 0; z.push(Number.isInteger(n) && n >= 2 && n <= ZMAX && whole(row[1]) === n ? n : 0);
      });
      if (z.some(Boolean)) p.z = z;
    }
    return p.q.length >= MIN_Q ? p : null;
  }

  // ---------- the games with a pack: the same order on both phones, from the seed in the link ----------
  function mix(doc, tag, n) {
    var r = C.mulberry32(C.hash32("pk|" + doc.seed + "|" + tag)), a = [], i, j, x;
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  function q(doc) { return doc.pk.q; }
  function choices(doc, i) { var row = q(doc)[i]; return mix(doc, "c" + i, row.length - 1).map(function (k) { return row[k + 1]; }); }
  function rightAt(doc, i) { return choices(doc, i).indexOf(q(doc)[i][1]); }
  // Wörter: the answer is shown, which question does it belong to? The right one and two others, mixed.
  function others(doc, i) { var n = q(doc).length, o = mix(doc, "w" + i, n).filter(function (k) { return k !== i; }).slice(0, 2); return mix(doc, "wo" + i, 3).map(function (k) { return [i].concat(o)[k]; }); }
  function nums(doc) { var z = doc.pk.z || []; return q(doc).map(function (x, i) { return i; }).filter(function (i) { return z[i] > 0; }); }
  // The slider's end, from the seed: the number sits at an even spread between 1/5 and 4/5 of the slider (as often below its
  // middle as above), the end rounded up to two digits only (37, 4100), so neither the middle nor a round end gives it away.
  function top(doc, i) {
    var z = doc.pk.z[i], v = z / (0.2 + 0.6 * C.mulberry32(C.hash32("pk|" + doc.seed + "|z" + i))());
    var p = Math.max(1, Math.pow(10, Math.floor(Math.log10(v)) - 1));
    return Math.min(ZMAX * 3, Math.max(z + 1, Math.ceil(v / p) * p));
  }
  function items(doc, g) {
    var X = function (lang) { return T(lang); };
    if (g === "schaetzen") return nums(doc).map(function (i) { return { w: "slide", l: "sch_go", min: 0, max: ZMAX * 3, maxOf: function (d) { return top(d, i); }, peek: function (d) { return q(d)[i][0]; } }; });
    var out = [];
    q(doc).forEach(function (row, i) {
      if (g === "abfragen") {
        out.push({ w: "show", l: "abf_think", list: function (d) { return [q(d)[i][0]]; } });
        out.push({ w: "pick", l: "abf_knew", n: 1, auto: true, top: function (d) { return q(d)[i][1]; }, from: function (d, m, now, lang) { return [X(lang).abf_yes, X(lang).abf_no]; } });
      } else if (g === "woerter") out.push({ w: "pick", l: "pk_match", n: 1, auto: true, top: function (d) { return q(d)[i][1]; }, from: function (d) { return others(d, i).map(function (k) { return q(d)[k][0]; }); } });
      else if (g === "typen") out.push({ w: "pick", l: "pk_pick", n: 1, auto: true, top: function (d) { return q(d)[i][0]; }, from: function (d) { return mix(d, "t" + i, q(d)[i].length - 1).map(function (k) { return q(d)[i][k + 1][0]; }); } });
      else out.push({ w: "pick", l: "pk_pick", n: 1, auto: true, top: function (d) { return q(d)[i][0]; }, from: function (d) { return choices(d, i); } });
    });
    return out;
  }
  // One person's answers -> how many were right, which questions are still open and, for Schätzen, the mean distance in percent.
  function score(doc, g, a) {
    var X = q(doc), ok = 0, open = [], off = [];
    if (g === "schaetzen") { nums(doc).forEach(function (i, k) { var z = doc.pk.z[i]; off.push(Math.min(100, Math.round(Math.abs(a[k] - z) / z * 100))); }); return { off: Math.round(off.reduce(function (s, x) { return s + x; }, 0) / off.length), n: off.length }; }
    X.forEach(function (row, i) {
      var hit = g === "abfragen" ? a[i * 2 + 1][0] === 0 : g === "woerter" ? others(doc, i)[a[i][0]] === i : a[i][0] === rightAt(doc, i);
      if (hit) ok++; else open.push(row[0] + " → " + row[1]);
    });
    return { ok: ok, n: X.length, open: open };
  }
  function scoreLine(s, who, lang) { var L = T(lang); return s.off !== undefined ? fmt(L.pk_off, { w: who, n: s.off }) : fmt(L.pk_score, { w: who, n: s.ok, m: s.n }); }
  // Typen: the type most answers point to; a tie goes the way the seed says, never by a rule that favours one type.
  function typeOf(doc, a) {
    var c = doc.pk.y.map(function () { return 0; }), order = mix(doc, "ty", c.length);
    q(doc).forEach(function (row, i) { var k = mix(doc, "t" + i, row.length - 1)[a[i][0]]; c[row[k + 1][1]]++; });
    return order.reduce(function (b, i) { return c[i] > c[b] ? i : b; }, order[0]);
  }
  function intro(doc, lang) { return [doc.pk.t, fmt(T(lang).pk_intro, { n: doc.g === "schaetzen" ? nums(doc).length : q(doc).length })]; }
  // A game works with this pack: learning and company packs for the four cards and the Team-Quiz, group packs for Typen,
  // Schätzen only with three numbers at least.
  var CHOICE = { luecke: 1, quiz: 1 };
  function fits(g, p) {
    return !!p && GAMES[g] === 1 && (g === "typen" ? p.m === "g" : p.m !== "g") && (g !== "schaetzen" || (p.z || []).filter(Boolean).length >= 3) &&
      (!CHOICE[g] || p.q.every(function (r) { return r.length >= 4; }));
  }
  // The game for a doc with a pack. Learning: two turns, both play, then both scores and what is still open. Company and
  // group: whoever makes it only sends; everybody plays alone on their own phone and sees only their own result
  // (stay: the same link goes on), so nothing comes back and there is no ranking with names.
  function game(doc) {
    if (!doc || !fits(doc.g, doc.pk)) return null;
    var g = doc.g, it = items(doc, g), first = { w: "show", l: "pk_start", list: function (d, m, now, lang) { return intro(d, lang); } };
    if (doc.pk.m === "l") return {
      turns: [it, it],
      result: function (d, m, lang) {
        var L = T(lang), a = score(d, g, m[0]), b = score(d, g, m[1]);
        var open = (a.open || []).concat(b.open || []).filter(function (x, i, all) { return all.indexOf(x) === i; });
        return { h: d.pk.t, lines: [scoreLine(a, L.first, lang), scoreLine(b, L.second, lang)].concat(open.slice(0, 4)) };
      }
    };
    var last = { w: "show", l: g === "typen" ? "pk_type" : "pk_you", later: g === "typen" ? "pk_group" : "pk_team", list: function (d, m, now, lang) {
      var L = T(lang);
      if (g === "typen") { var y = d.pk.y[typeOf(d, now)]; return [fmt(L.pk_is, { n: y[0] }), y[1]]; }
      return [scoreLine(score(d, g, now), L.pk_me, lang)];
    }, notes: function (d, m, now) { return g === "typen" ? [] : score(d, g, now).open || []; } };
    return { stay: true, turns: [[first], it.concat([last])], result: function (d, m, lang) { return { h: d.pk.t, lines: [T(lang)[g === "typen" ? "pk_group" : "pk_team"]] }; } };
  }
  var api = { MODES: MODES, MAX_Q: MAX_Q, MIN_Q: MIN_Q, GAMES: GAMES, CHOICE: CHOICE, sanitize: sanitize, whole: whole, fits: fits, game: game, choices: choices, rightAt: rightAt, top: top, typeOf: typeOf, score: score, nums: nums };
  if (node) module.exports = api; else root.QuizPack = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
