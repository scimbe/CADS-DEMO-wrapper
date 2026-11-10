/* Zug per Link on screen: one renderer for all games, driven by the prompts in turns.js. */
(function () {
"use strict";
var A = window.DailyApp, X = window.DailyModes, Tn = window.Turns, Q = window.Quest, C = window.DuellCore, D = window.Daily, R = window.Render, Kit = window.Kit, t = Kit.t, el = A.el;
function L() { return Tn.T(Kit.lang); }
function say(k, o) { return String(C.form(L(), k, o && o.n, Kit.lang)).replace(/\{(\w+)\}/g, function (m, n) { return o[n]; }); }
// A game may name its own words for the shared buttons (GAMES[g].words), so a date poll does not speak of moves.
function word(doc, k) { var w = Tn.GAMES[doc.g] && Tn.GAMES[doc.g].words; return (w && w[k]) || k; }
function seed() { var a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0]; }
// What a step asks, in words: its own title when the text has a gap to fill ({l}, {n}), else the plain text.
function ask(p, doc, m) { return p.title ? p.title(doc, Kit.lang) : p.top ? p.top(doc, m, Kit.lang) : L()[p.l].replace(": {q}", "").replace(/:\s*$/, ""); }
// A choice's state for the screen reader (and a tick, style.css), on chips and cells alike.
function press(b, on) { b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
// The socks' cells by row and column, A-E and 1-5.
function cell(c, i) { c.setAttribute("aria-label", say("cell", { r: "ABCDE"[Math.floor(i / 5)], c: i % 5 + 1 })); }

/* ---------- voices: only in this tab's memory, overwritten after use ---------- */
var VOICE = {};
function wipe(k) { if (VOICE[k]) VOICE[k].fill(0); delete VOICE[k]; }
function listen(ms) {
  return new Promise(function (done) {
    var over = false, fake = function () { if (over) return; over = true; Kit.toast(t("noMic")); done(Studio.dummyVoice()); }, wait = setTimeout(fake, 20000);   // a prompt nobody answers must not freeze the game
    var ac = Kit.audio(true);
    if (!navigator.mediaDevices || !ac || !ac.createScriptProcessor) { fake(); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
      clearTimeout(wait); if (over) { st.getTracks().forEach(function (x) { x.stop(); }); return; }
      // Straight from the audio graph: no file, no codec, just samples in memory.
      var src = ac.createMediaStreamSource(st), sp = ac.createScriptProcessor(4096, 1, 1), mute = ac.createGain(), got = [], n = 0;
      mute.gain.value = 0; sp.onaudioprocess = function (e) { var c = e.inputBuffer.getChannelData(0); got.push(Float32Array.from(c)); n += c.length; };
      src.connect(sp); sp.connect(mute); mute.connect(ac.destination);
      setTimeout(function () {
        sp.disconnect(); src.disconnect(); mute.disconnect(); st.getTracks().forEach(function (x) { x.stop(); });
        var k = ac.sampleRate / Studio.SR, o = new Float32Array(Math.floor(n / k)), all = new Float32Array(n), at = 0;
        got.forEach(function (c) { all.set(c, at); at += c.length; c.fill(0); }); got.length = 0;
        for (var i = 0; i < o.length; i++) o[i] = all[Math.floor(i * k)];
        all.fill(0); over = true; done(o.length ? o : Studio.dummyVoice());
      }, ms);
    }).catch(fake);
  });
}
window.TurnVoice = { has: function (k) { return !!VOICE[k]; } };

/* ---------- picture: own vector shapes, no emoji ---------- */
function shape(c, f, x, y, r, col) {
  c.save(); c.translate(x, y); c.fillStyle = col; c.strokeStyle = col; c.lineWidth = r * 0.28; c.beginPath();
  if (f === "star") { for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.45 : r; c.lineTo(Math.cos(a) * q, Math.sin(a) * q); } c.closePath(); c.fill(); }
  else if (f === "heart") { c.moveTo(0, r * 0.9); c.bezierCurveTo(-r * 1.5, -r * 0.1, -r * 0.6, -r * 1.1, 0, -r * 0.35); c.bezierCurveTo(r * 0.6, -r * 1.1, r * 1.5, -r * 0.1, 0, r * 0.9); c.fill(); }
  else if (f === "bolt") { [[0.2, -1], [-0.55, 0.15], [-0.05, 0.15], [-0.2, 1], [0.55, -0.2], [0.05, -0.2]].forEach(function (p) { c.lineTo(p[0] * r, p[1] * r); }); c.closePath(); c.fill(); }
  else if (f === "ring") { c.arc(0, 0, r * 0.8, 0, 6.3); c.stroke(); }
  else if (f === "coin") { c.arc(0, 0, r, 0, 6.3); c.fill(); c.fillStyle = "rgba(0,0,0,.35)"; c.font = "900 " + Math.round(r * 1.2) + "px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("€", 0, r * 0.06); }
  else if (f === "drop") { c.moveTo(0, -r); c.bezierCurveTo(r * 1.1, 0, r * 0.7, r, 0, r); c.bezierCurveTo(-r * 0.7, r, -r * 1.1, 0, 0, -r); c.fill(); }
  else { c.arc(0, 0, r, 0, 6.3); c.fill(); c.fillStyle = "rgba(0,0,0,.35)"; [[-0.4, -0.3], [0.35, -0.45], [0.05, 0.1], [-0.3, 0.5], [0.5, 0.4]].forEach(function (p) { c.beginPath(); c.arc(p[0] * r, p[1] * r, r * 0.13, 0, 6.3); c.fill(); }); }
  c.restore();
}
function lines(c, list, W, y, size, col) {
  c.font = "800 " + size + "px system-ui,sans-serif"; c.fillStyle = col; c.textAlign = "center"; c.textBaseline = "top";
  list.forEach(function (s) {
    var cur = "";
    String(s).split(" ").forEach(function (w) { var n = cur ? cur + " " + w : w; if (c.measureText(n).width > W * 0.84 && cur) { c.fillText(cur, W / 2, y); y += size * 1.25; cur = w; } else cur = n; });
    if (cur) { c.fillText(cur, W / 2, y); y += size * 1.25; } y += size * 0.4;
  });
  return y;
}
function title(doc) { var i = doc.i ? D.byId(doc.i) : null, T = i ? D.plainTitle((i[Kit.lang] || i.de).t) : ""; return doc.t || T || t("turn"); }
R.extra.turn = function (c, W, H, doc) {
  if (listOf(doc)) return drawShop(c, W, H, doc);
  var own = Tn.GAMES[doc.g] && Tn.GAMES[doc.g].pic; if (own) return own(c, W, H, doc);   // a game that draws its own picture (dart: the board)
  var a = doc.col[0], b = doc.col[1], ink = R.ink(a), st = Tn.state(doc), res = Tn.result(doc, Kit.lang);
  c.fillStyle = a; c.fillRect(0, 0, W, H); R.rays(c, W, H, "rgba(0,0,0,.05)", 0.2);
  shape(c, doc.f, W * 0.84, H * 0.84, W * 0.08, b); shape(c, doc.f, W * 0.14, H * 0.8, W * 0.05, b);
  R.block(c, res ? res.h : title(doc), W * 0.07, H * 0.1, W * 0.86, H * 0.34, ink, null);
  var face = res ? null : Tn.face(doc, Kit.lang);
  if (res) lines(c, res.lines, W, H * 0.5, W * 0.038, ink);
  else if (face) lines(c, face, W, H * 0.5, W * 0.045, ink);   // the standing so far, which is what the group wants to see
  else if (!st.turn) { var i0 = doc.i ? D.byId(doc.i) : null; lines(c, [doc.s || (i0 ? (i0[Kit.lang] || i0.de).s : ""), L()[word(doc, "you_start")]], W, H * 0.52, W * 0.05, ink); }   // the goal, not the machinery
  else lines(c, [say("picture_turn", { n: st.turn + 1, m: st.total })], W, H * 0.56, W * 0.05, ink);
};

/* ---------- the shopping list: this phone keeps what it knows of each list, so a reply merges instead of replacing ---------- */
var SHOP_KEEP = 12;
function shopStore() { var s = Kit.store.shop; return s && typeof s === "object" && !Array.isArray(s) ? s : {}; }
// Shopping list and task list share the merging; listOf gives the game's caps, words picks its words (ein_ / tdo_).
function listOf(doc) { var g = Tn.GAMES[doc.g]; return g && g.list ? g.list : null; }
function words(doc) { return doc.g === "todo" ? "tdo" : doc.g === "wunsch" ? "wun" : "ein"; }
function shopKept(doc) { var v = shopStore()["s" + doc.seed]; return Tn.shopOk(v, listOf(doc)) ? v : null; }
function shopKeep(doc, v) {
  var s = shopStore(), k; delete s["s" + doc.seed]; s["s" + doc.seed] = v;
  for (k = Object.keys(s); k.length > SHOP_KEEP; k.shift()) delete s[k[0]];
  Kit.store.shop = s; Kit.save();
}
// The list as this phone sees it: the link merged with what it knew of the same list before.
function shopSeen(doc) { var m = Tn.moves(doc), mine = shopKept(doc); return m.length ? (mine ? Tn.shopMerge(m[0][0], mine, listOf(doc)) : m[0][0]) : null; }
function shopSync(ed) { var v = shopSeen(ed.doc); if (!v) return; ed.doc.q = Tn.seal([[v]], ed.doc.seed); ed.base.q = ed.doc.q; shopKeep(ed.doc, v); }
function myFace() { var i = Tn.FACES.indexOf(A.me().emoji); return i < 0 ? 0 : i; }
// WCAG contrast: black or white, whichever reads better on this colour.
function rl(hex) { var v = [1, 3, 5].map(function (i) { var x = parseInt(hex.slice(i, i + 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
function inkOn(hex) { var l = rl(hex); return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff"; }   // the better of the two is always at least 4.58:1
function fit(c, s, w) { s = String(s); if (c.measureText(s).width <= w) return s; while (s.length > 1 && c.measureText(s + "…").width > w) s = s.slice(0, -1); return s + "…"; }
// The card picture is the list itself on a sheet of paper: dark ink on white, whatever colours the card has. No emoji in exports.
function drawShop(c, W, H, doc) {
  var ed = A.ed(), out = ed && ed.doc === doc && ed.next ? ed.next : doc;   // in the editor: the list as it will go out, in the colours chosen now
  var cf = listOf(doc), K = words(doc), hide = !!(cf && cf.wish), a = doc.col[0], b = doc.col[1], ink = inkOn(a), v = out === doc ? shopSeen(doc) : Tn.moves(out)[0][0], res = Tn.result(out, Kit.lang), rows = v ? Tn.shopRows(v, cf) : [], i0 = doc.i ? D.byId(doc.i) : null;
  c.fillStyle = a; c.fillRect(0, 0, W, H); R.rays(c, W, H, "rgba(0,0,0,.05)", 0.2);
  R.block(c, res ? res.h : title(doc), W * 0.07, H * 0.035, W * 0.86, H * 0.15, ink, null);
  c.font = "800 " + Math.round(W * 0.036) + "px system-ui,sans-serif"; c.fillStyle = ink; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(fit(c, v ? (hide ? say("wun_count", { n: v[1].length }) : Tn.shopCount(v, Kit.lang, cf)) : doc.s || (i0 ? (i0[Kit.lang] || i0.de).s : ""), W * 0.86), W / 2, H * 0.205);
  var x0 = W * 0.06, y0 = H * 0.235, pw = W * 0.88, ph = H - W * 0.085 - y0, n = Math.max(rows.length, 1), rh = Math.min(ph * 0.92 / n, W * 0.08), fs = Math.round(rh * 0.5), pad = W * 0.045;
  c.fillStyle = b; c.fillRect(x0 + W * 0.014, y0 + W * 0.014, pw, ph);
  c.fillStyle = "#fffdf7"; c.fillRect(x0, y0, pw, ph); c.strokeStyle = "#111111"; c.lineWidth = W * 0.004; c.strokeRect(x0, y0, pw, ph);
  var y = y0 + ph * 0.04 + rh / 2;
  if (!rows.length) { c.font = "700 " + Math.round(W * 0.04) + "px system-ui,sans-serif"; c.fillStyle = "#4b5563"; c.fillText(L()[K + "_empty"], W / 2, y0 + ph / 2); }
  rows.forEach(function (r) {
    var done = !hide && r.bought.length > 0, box = fs * 1.05, bx = x0 + pad, who = hide ? "" : done ? say(K + "_got", { n: r.bought.map(function (p) { return p[0]; }).join(", ") }) : r.bring.length ? say(K + "_brings", { n: r.bring.map(function (p) { return p[0]; }).join(", ") }) : r.due ? Tn.dueText(r.due, Kit.lang) : "";
    c.strokeStyle = "#dbe4f0"; c.lineWidth = Math.max(1, W * 0.002); c.beginPath(); c.moveTo(x0 + pad * 0.5, y + rh / 2); c.lineTo(x0 + pw - pad * 0.5, y + rh / 2); c.stroke();
    c.lineWidth = W * 0.004; c.strokeStyle = "#111111"; c.strokeRect(bx, y - box / 2, box, box);
    if (done) { c.fillStyle = "#111111"; c.fillRect(bx, y - box / 2, box, box); c.strokeStyle = "#ffffff"; c.lineWidth = box * 0.16; c.beginPath(); c.moveTo(bx + box * 0.2, y); c.lineTo(bx + box * 0.42, y + box * 0.22); c.lineTo(bx + box * 0.8, y - box * 0.24); c.stroke(); }
    var tx = bx + box + pad * 0.5, right = x0 + pw - pad * 0.6, roomWho = who ? pw * 0.36 : 0;
    c.textAlign = "left"; c.textBaseline = "middle"; c.font = "800 " + fs + "px system-ui,sans-serif"; c.fillStyle = done ? "#4b5563" : "#111111";
    var s = fit(c, r.label, right - tx - roomWho - pad * 0.3); c.fillText(s, tx, y);
    if (done) { var w = c.measureText(s).width; c.strokeStyle = "#4b5563"; c.lineWidth = Math.max(2, fs * 0.08); c.beginPath(); c.moveTo(tx, y); c.lineTo(tx + w, y); c.stroke(); }
    if (who) { c.textAlign = "right"; c.font = "700 " + Math.round(fs * 0.72) + "px system-ui,sans-serif"; c.fillStyle = done ? "#166534" : "#1d4ed8"; c.fillText(fit(c, who, roomWho), right, y); }
    y += rh;
  });
  shape(c, doc.f, W * 0.92, H * 0.2, W * 0.035, b);
  return ink;
}
window.TurnShop = { draw: drawShop, keep: shopKeep };

/* ---------- one prompt ---------- */
var draw = {
  // p.show(v, lang) writes the value (e.g. as money), p.defOf(doc) is where it starts, p.step adds − and + buttons
  slide: function (box, p, set, ctx) {
    var v = p.defOf ? p.defOf(ctx.doc) : p.def || p.min || 0, row = el("label", "slide"), r = el("input"), b = el("b", "", ""), n = b.appendChild(document.createTextNode("")), u = p.unit && b.appendChild(el("span", "", " " + p.unit));
    if (u) u.dataset.part = "einheit";
    function shown(x) { n.nodeValue = p.show ? p.show(x, Kit.lang) : x; r.setAttribute("aria-valuetext", b.textContent); }
    if (p.show) row.classList.add("money");
    row.appendChild(el("span", "", "")); r.type = "range"; r.min = p.min || 0; r.max = p.maxOf ? p.maxOf(ctx.doc) : p.max; if (p.step) r.step = p.step; r.value = v; r.setAttribute("aria-label", p.title ? p.title(ctx.doc, Kit.lang) : L()[p.l]);
    r.addEventListener("input", function () { shown(Number(r.value)); set(Number(r.value)); });
    row.appendChild(r); row.appendChild(b); box.appendChild(row); shown(v); set(v);
    if (p.step) {
      var nb = el("div", "chips");
      [["sl_less", -1, "−"], ["sl_more", 1, "+"]].forEach(function (x) {
        var c = el("button", "chip", x[2], function () { Kit.sfx.tap(); var n = Math.min(Number(r.max), Math.max(Number(r.min), Number(r.value) + x[1] * p.step)); r.value = n; shown(Number(r.value)); set(Number(r.value)); });
        c.setAttribute("aria-label", L()[x[0]]); nb.appendChild(c);
      });
      box.appendChild(nb);
    }
  },
  show: function (box, p, set, ctx) {
    p.list(ctx.doc, ctx.m, ctx.now, Kit.lang).forEach(function (s) { box.appendChild(el("p", "qtext", s)); });
    if (p.card) p.card(box, ctx.doc, ctx.m, ctx.now, Kit.lang);   // a picture of what is asked about, drawn by the game's part
    var n = p.notes ? p.notes(ctx.doc, ctx.m, ctx.now, Kit.lang).filter(Boolean) : [];   // e.g. what a quiz still has open; a long privacy text folds
    if (n.join("").length > 160) brief(box, n[0], n, n[0].indexOf(t("wsw_h")) === 0); else n.forEach(function (s) { box.appendChild(el("p", "note", s)); });
    if (p.later) box.appendChild(el("p", "note", L()[p.later]));
    set(0);
  },
  text: function (box, p, set, ctx) {
    if (p.adult && minor()) { box.appendChild(el("p", "qtext", L().sam_minor)); set(null); return; }   // a PayPal name: 18+ only
    if (p.top) box.appendChild(el("p", "qtext", p.top(ctx.doc, ctx.m, Kit.lang)));
    var f = el("input", "field"); f.maxLength = p.max; f.autocomplete = "off"; f.setAttribute("aria-label", ask(p, ctx.doc, ctx.m)); if (p.hint) f.placeholder = L()[p.hint];
    function check() { var v = f.value.trim(), ok = Tn.okAnswer(p, v, ctx.doc, Kit.lang, ctx.m, ctx.now); set(ok ? v : null); }
    f.addEventListener("input", check);
    var mine = p.pref && A.me().pref && A.me().pref[p.pref];   // my own default (Profil), visible in the field and changeable
    box.appendChild(f); set(null); if (mine) { f.value = mine; check(); }
  },
  // An amount in euros and cents; under the field what each person pays and the cents left over.
  money: function (box, p, set, ctx) {
    var f = el("input", "field"), info = el("p", "note", "");
    f.inputMode = "decimal"; f.maxLength = 9; f.autocomplete = "off"; f.setAttribute("aria-label", L()[p.l]); if (p.hint) f.placeholder = L()[p.hint];
    f.addEventListener("input", function () {
      var c = Tn.parseCents(f.value), ok = c !== null && Tn.okAnswer(p, c, ctx.doc, Kit.lang, ctx.m, ctx.now);
      info.textContent = ok ? p.line(c, ctx.now, Kit.lang) : ""; set(ok ? c : null);
    });
    box.appendChild(f); box.appendChild(info); set(null);
  },
  // A plain link to PayPal.me: the shells hand it to the browser or the PayPal app. Nothing comes back, nobody counts who paid.
  // Under 18 there is no PayPal link: the age band comes from my defaults (Profil); without one, a note and one tap to say 18+.
  pay: function (box, p, set, ctx) {
    var url = p.link(ctx.doc, ctx.m), after = el("p", "note", L().sam_after), gate = el("div"), more = p.more ? p.more(ctx.m, Kit.lang) : "";
    if (more) box.appendChild(el("p", "note", more));
    box.appendChild(el("p", "note", L().sam_safe));
    function link() {
      gate.textContent = "";
      if (!url) return;
      if (minor()) { gate.appendChild(el("p", "qtext", L().sam_minor)); return; }
      if (!D.adult(A.me())) {
        gate.appendChild(el("p", "note", L().sam_age));
        gate.appendChild(el("button", "chip", L().sam_adult, function () { Kit.sfx.tap(); var f = Object.assign({}, A.me().pref || {}); f.age = "a18"; A.savePref(f); link(); }));
        return;
      }
      var a = el("a", "btn hot", say("sam_btn", { e: p.share(ctx.m, Kit.lang) })); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.id = "paylink";
      a.addEventListener("click", function () { Kit.sfx.tap(); after.hidden = false; }); gate.appendChild(a);
    }
    box.appendChild(gate); link();
    after.hidden = true; box.appendChild(after); set(0);
  },
  list: function (box, p, set, ctx) {
    var fs = [], pre = ctx && ctx.ed.pre && ctx.ed.pre[p.l];
    function up() { var v = fs.map(function (f) { return Q.clean(f.value, p.max); }), have = v.filter(Boolean); if (p.least && (have.length < p.least || new Set(have.map(Q.fold)).size < have.length)) { set(null); return; } set(p.loose ? fs.map(function (f, i) { return f.value.trim() ? v[i] : ""; }) : v.every(Boolean) && (p.same || new Set(v.map(Q.fold)).size === p.n) && (!p.bytes || new TextEncoder().encode(v.join("")).length <= p.bytes) ? v : null); }
    for (var i = 0; i < p.n; i++) { var f = el("input", "field"); f.maxLength = p.max; f.autocomplete = "off"; f.setAttribute("aria-label", ask(p, ctx.doc, ctx.m) + " " + (i + 1)); if (p.hints) f.placeholder = p.hints(Kit.lang)[i]; f.addEventListener("input", up); if (pre && pre[i]) f.value = pre[i]; box.appendChild(f); fs.push(f); }
    if (p.loose || pre) up(); else set(null);
  },
  pick: function (box, p, set, ctx) {
    var on = [], row = el("div", "chips"), items = p.from(ctx.doc, ctx.m, ctx.now, Kit.lang);
    if (p.top) box.appendChild(el("p", "qtext", p.top(ctx.doc, ctx.m, Kit.lang)));
    if (p.card) p.card(box, ctx.doc, ctx.m, ctx.now, Kit.lang);
    items.forEach(function (s, i) {
      var b = el("button", "chip", s, function () {
        Kit.sfx.tap(); var at = on.indexOf(i);
        if (at >= 0) on.splice(at, 1); else { if (on.length >= p.n) press(row.children[on.shift()], false); on.push(i); }
        press(b, on.indexOf(i) >= 0); set(on.length === p.n ? on.slice() : null);
      });
      press(b, false); row.appendChild(b);
    });
    box.appendChild(row); set(null);
  },
  rank: function (box, p, set, ctx) {
    var order = [], items = p.from(ctx.doc, ctx.m, ctx.now, Kit.lang), row = el("div", "chips");
    items.forEach(function (s, i) {
      var b = el("button", "chip", s, function () {
        Kit.sfx.tap(); var at = order.indexOf(i); if (at >= 0) order.splice(at, 1); else order.push(i);
        Array.from(row.children).forEach(function (x, n) { var w = order.indexOf(n); x.textContent = (w >= 0 ? w + 1 + ". " : "") + items[n]; press(x, w >= 0); });
        if (order.length === items.length - 1) { order.push(items.findIndex(function (x, n) { return order.indexOf(n) < 0; })); Array.from(row.children).forEach(function (x, n) { x.textContent = order.indexOf(n) + 1 + ". " + items[n]; press(x, true); }); }
        set(order.length === items.length ? order.slice() : null);
      });
      press(b, false); row.appendChild(b);
    });
    box.appendChild(row); set(null);
  },
  // Up to five fingers at once; when nobody moved for three seconds one is chosen.
  touch: function (box, p, set) {
    var pad = el("div", "touchpad"), on = {}, timer = 0;
    function arm() {
      clearTimeout(timer); var ids = Object.keys(on); if (ids.length < 2) return;
      timer = setTimeout(function () { var a = new Uint32Array(1); window.crypto.getRandomValues(a); var who = on[ids[a[0] % ids.length]]; pad.textContent = ""; who.classList.add("win"); pad.appendChild(who); Kit.sfx.win(); Kit.haptic(60); setTimeout(function () { set(0); }, 900); }, 3000);
    }
    pad.addEventListener("pointerdown", function (e) {
      e.preventDefault(); if (Object.keys(on).length >= 5) return;
      var r = pad.getBoundingClientRect(), d = el("i", "touchdot"); d.style.left = e.clientX - r.left + "px"; d.style.top = e.clientY - r.top + "px"; on[e.pointerId] = d; pad.appendChild(d); Kit.sfx.tap(); arm();
    });
    function up(e) { if (on[e.pointerId]) { on[e.pointerId].remove(); delete on[e.pointerId]; arm(); } }
    pad.addEventListener("pointerup", up); pad.addEventListener("pointercancel", up);
    box.appendChild(pad); set(null);
  },
  rec: function (box, p, set, ctx) {
    var b = el("button", "btn hot", "🎙 " + L().rec_go, function () {
      if (b.disabled) return; b.disabled = true; b.textContent = "● " + L().rec_on;
      listen(p.ms).then(function (pcm) { VOICE[p.slot] = pcm; b.textContent = "✓"; set(0); });
    });
    box.appendChild(b); set(null);
  },
  // One press, one playback, then the samples are overwritten and the slot is empty.
  once: function (box, p, set, ctx) {
    var pcm = VOICE[p.slot], b = el("button", "btn hot big", say("mau_from", { n: p.who(ctx.m) }), function () {
      if (!VOICE[p.slot]) return; var o = Studio.warp(VOICE[p.slot], p.fx(ctx.m)); Kit.playPcm(o, Studio.SR, false);
      wipe(p.slot); setTimeout(function () { o.fill(0); }, o.length / Studio.SR * 1000 + 200); b.disabled = true; b.textContent = L().mau_gone; set(0);
    });
    if (!pcm) { b.disabled = true; b.textContent = L().rec_lost; box.appendChild(b); set(0); return; }
    box.appendChild(b); set(null);
  },
  parrot: function (box, p, set) {
    var src = VOICE[p.from], row = el("div", "chips");
    row.appendChild(el("button", "chip", "▶ " + L().pap_back, function () { if (src) Kit.playPcm(Array.from(src).reverse(), Studio.SR, false); }));
    var r = el("button", "chip", "🎙 " + L().rec_go, function () {
      if (r.disabled) return; r.disabled = true; r.textContent = "● " + L().rec_on;
      listen(2500).then(function (pcm) { VOICE[p.slot] = pcm; Kit.playPcm(Float32Array.from(pcm).reverse(), Studio.SR, false); wipe(p.from); r.textContent = "✓"; setTimeout(function () { set(0); }, pcm.length / Studio.SR * 1000 + 300); });
    });
    row.appendChild(r); box.appendChild(row); set(null);
  },
  whose: function (box, p, set, ctx) {
    var s = p.slot(ctx.doc), row = el("div", "chips");
    box.appendChild(el("button", "chip", "▶ " + L().tie_play, function () { if (VOICE[s]) Kit.playPcm(Studio.warp(VOICE[s], p.fx(ctx.doc)), Studio.SR, false); }));
    p.from(ctx.doc, ctx.m).forEach(function (n, i) { row.appendChild(el("button", "chip", n, function () { Kit.sfx.tap(); if (i === 2 || ctx.now.length === 2) wipe(s); set(i); })); });
    box.appendChild(row); set(null);
  },
  // Tap a fry to mark it and all to its right, tap it again to take them; the bot answers after a short look.
  nim: function (box, p, set, ctx) {
    var h = p.heaps.slice(), good = ctx.now[0][0] === 1, mark = null, step = 0, wrap = el("div", "nim"), info = el("p", "lbl", L().pom_you);
    function draw() {
      wrap.textContent = "";
      h.forEach(function (n, i) {
        wrap.appendChild(el("p", "lbl", say("pom_pile", { i: i + 1 })));
        var row = el("div", "chips");
        for (var k = 0; k < n; k++) (function (k) {
          var on = mark && mark[0] === i && k >= mark[1];
          row.appendChild(el("button", "chip fry" + (on ? " on" : ""), "🍟", function () {
            if (info.dataset.busy) return;
            if (!on) { mark = [i, k]; Kit.sfx.tap(); draw(); return; }
            take(i, n - mark[1], false);
          }));
        })(k);
        wrap.appendChild(row);
      });
    }
    function left() { return h.reduce(function (a, b) { return a + b; }, 0); }
    function take(i, k, bot) {
      h[i] -= k; mark = null; step++; Kit.sfx[bot ? "tap" : "pop"](); draw();
      if (!left()) { info.textContent = bot ? L().pom_won : L().pom_lost; set(bot ? 1 : 0); return; }
      if (bot) { info.textContent = say("pom_botdid", { k: k, i: i + 1 }) + " " + L().pom_you; return; }
      info.dataset.busy = "1"; info.textContent = L().pom_think;
      setTimeout(function () { if (!box.isConnected) return; delete info.dataset.busy; var mv = p.bot(ctx.doc, h, step, good); take(mv[0], mv[1], true); }, 600);
    }
    box.appendChild(info); box.appendChild(wrap); draw(); set(null);
  },
  // The beat plays and breaks off; the stop card names the statue. People judge the wobbling, the phone sees nothing.
  freeze: function (box, p, set, ctx) {
    var bpm = 124, pcm = Studio.renderBeat(p.beat(ctx.now[0][0]), bpm, 8), loop = null, timer = 0, r = 0, card = el("p", "qtext", L().dis_ready);
    function stop() { if (loop) { try { loop.stop(); } catch (e) {} loop = null; } clearTimeout(timer); }
    function go() {
      stop(); if (!box.isConnected) return; card.textContent = "♪ ♪ ♪"; loop = Kit.playPcm(pcm, Studio.SR, true);
      timer = setTimeout(function () { stop(); if (!box.isConnected) return; Kit.haptic(80); card.textContent = say("dis_stop", { s: p.statue(ctx.doc, r, Kit.lang) }); r++; }, p.pause(ctx.doc, r) * 1000);
    }
    box.appendChild(card);
    box.appendChild(el("button", "chip", L().dis_play, go));
    box.appendChild(el("button", "chip", L().dis_end, function () { stop(); set(Math.min(p.max, r)); }));
    set(null);
  },
  // Each phone in the call shows its own side from the same link: the figure to speak, or six cards to guess from.
  voices: function (box, p, set, ctx) {
    var speak = ctx.now[0][0] === 0, r = 0, hits = 0, q = el("p", "qtext", ""), row = el("div", "chips"), info = el("p", "lbl", "");
    function round() {
      row.textContent = ""; info.textContent = say("stm_round", { n: r + 1, m: p.rounds });
      if (r >= p.rounds) { q.textContent = speak ? L().stm_done : say("stm_h", { n: hits }); set(hits); return; }
      if (speak) { q.textContent = p.figure(ctx.doc, r, Kit.lang); row.appendChild(el("button", "chip", L().next, function () { r++; round(); })); return; }
      q.textContent = L().stm_which;
      p.cards(ctx.doc, r, Kit.lang).forEach(function (s, i) {
        row.appendChild(el("button", "chip", s, function () { var ok = i === p.right(ctx.doc, r); if (ok) { hits++; Kit.sfx.pop(); } else Kit.tone(200, 90, 0.08, "square", 0.05); Kit.toast(ok ? L().stm_yes : say("stm_no", { s: p.figure(ctx.doc, r, Kit.lang) })); r++; round(); }));
      });
    }
    box.appendChild(info); box.appendChild(q); box.appendChild(row); round(); if (r < p.rounds) set(null);
  },
  // A door opens on its day in December, on the phone's own date; after Christmas all of them stay open.
  doors: function (box, p, set, ctx) {
    var now = new Date(), open = now.getMonth() === 11 ? now.getDate() : now.getMonth() === 0 ? 24 : 0, g = el("div", "bgrid sgrid"), say1 = el("p", "qtext", open ? L().adv_tap : L().adv_wait);
    for (var i = 0; i < 24; i++) (function (i) {
      var c = el("button", "bcell", String(i + 1), function () { if (i < open) { say1.textContent = p.text(ctx.doc, ctx.m, i, Kit.lang); c.classList.add("on"); Kit.sfx.pop(); } else Kit.tone(200, 90, 0.08, "square", 0.05); });
      c.disabled = i >= open; g.appendChild(c);
    })(i);
    box.appendChild(say1); box.appendChild(g); set(null);
  },
  // The price falls in eight seconds; a tap buys at the price shown. Only the tap goes into the link.
  drop: function (box, p, set, ctx) {
    var n = el("p", "qtext", String(p.max)), t0 = 0, run = 0, done = false, b;
    box.appendChild(el("p", "lbl", say("aq_item", { o: p.item(ctx.doc, Kit.lang), v: p.worth(ctx.doc) })));
    box.appendChild(n);
    function price() { return Math.max(0, p.max - Math.floor((Date.now() - t0) / 80)); }
    b = el("button", "chip", L().aq_start, function () {
      if (done) return;
      if (!t0) { t0 = Date.now(); b.textContent = L().aq_now; run = setInterval(function () { var v = price(); n.textContent = String(v); if (!v || !box.isConnected) { clearInterval(run); if (!done && box.isConnected) { done = true; set(0); } } }, 50); return; }
      done = true; clearInterval(run); Kit.sfx.pop(); set(price());
    });
    box.appendChild(b); set(null);
  },
  grid: function (box, p, set) {
    var on = [], g = el("div", "bgrid sgrid");
    for (var i = 0; i < 25; i++) (function (i) {
      var c = el("button", "bcell", null, function () { var at = on.indexOf(i); if (at >= 0) on.splice(at, 1); else if (on.length < p.n) on.push(i); press(c, on.indexOf(i) >= 0); Kit.sfx.tap(); set(on.length === p.n ? on.slice() : null); });
      cell(c, i); press(c, false); g.appendChild(c);
    })(i);
    box.appendChild(g); set(null);
  },
  // The answers come from the other side's hidden socks in the link: found, near or far.
  probe: function (box, p, set, ctx) {
    var socks = p.socks(ctx.doc, ctx.m), old = p.before(ctx.doc, ctx.m), taps = [], g = el("div", "bgrid sgrid"), mark = ["·", "~", "🧦"], info = el("p", "lbl", say("sok_left", { n: p.n }));
    function show(c, i) { var a = Tn.sockAnswer(socks, i); c.textContent = mark[a]; c.classList.add("a" + a); c.disabled = true; c.setAttribute("aria-label", c.getAttribute("aria-label") + ": " + mark[a]); }
    for (var i = 0; i < 25; i++) (function (i) {
      var c = el("button", "bcell", null, function () {
        if (taps.length >= p.n) return; taps.push(i); show(c, i); Kit.sfx[Tn.sockAnswer(socks, i) === 2 ? "pop" : "tap"]();
        info.textContent = say("sok_left", { n: p.n - taps.length }); set(taps.slice());
      });
      cell(c, i); if (old.indexOf(i) >= 0) show(c, i); g.appendChild(c);
    })(i);
    box.appendChild(info); box.appendChild(g); box.appendChild(el("p", "note", L().sok_key)); set(null);
  },
  // A puff of air puts out a candle. The microphone only gives a loudness, nothing is kept; without it a tap does the same.
  blow: function (box, p, set) {
    var row = el("div", "chips"), left = p.n, st = null, ac = null, last = 0;
    function out(b) { if (b.disabled) return; b.disabled = true; b.textContent = "·"; Kit.sfx.pop(); left--; if (!left) { stop(); set(0); } }
    function stop() { if (st) st.getTracks().forEach(function (x) { x.stop(); }); if (ac) ac.close(); st = ac = null; }
    for (var i = 0; i < p.n; i++) (function () { var b = el("button", "chip", "🕯️", function () { out(b); }); row.appendChild(b); })();
    box.appendChild(row);
    box.appendChild(el("button", "chip", L().ker_mic, async function () {
      try {
        st = await navigator.mediaDevices.getUserMedia({ audio: true }); ac = new AudioContext();
        var an = ac.createAnalyser(), buf = new Uint8Array(an.fftSize); ac.createMediaStreamSource(st).connect(an);
        (function loop() {
          if (!st || !box.isConnected) { stop(); return; }
          an.getByteTimeDomainData(buf); var s = 0; buf.forEach(function (x) { s += (x - 128) * (x - 128); });
          if (Math.sqrt(s / buf.length) > 28 && Date.now() - last > 450) { last = Date.now(); var b = Array.from(row.children).find(function (x) { return !x.disabled; }); if (b) out(b); }
          requestAnimationFrame(loop);
        })();
      } catch (e) { Kit.toast(L().ker_nomic); }
    }));
    set(null);
  },
  // Each word on a paper in the room opens the next hint; the time is what stays.
  hunt: function (box, p, set, ctx) {
    var list = p.list(ctx.doc, ctx.m, Kit.lang), at = 0, t0 = Date.now(), hint = el("p", "qtext", list[0].hint), f = el("input", "field");
    f.maxLength = 30; f.autocomplete = "off"; f.setAttribute("aria-label", L()[p.l]);
    f.addEventListener("input", function () {
      if (Q.fold(f.value.trim()) !== Q.fold(list[at].w)) return;
      Kit.sfx.pop(); at++; f.value = "";
      if (at >= list.length) set(Math.min(p.max, Math.max(1, Math.round((Date.now() - t0) / 1000)))); else hint.textContent = list[at].hint;
    });
    box.appendChild(hint); box.appendChild(f); set(null);
  },
  // Every tap is kept, so the other phone can replay the game. Nothing here looks at the player: the stream of blocks is fixed by the seed.
  blocks: function (box, p, set, ctx) {
    var doc = ctx.doc, moves = [], st = { grid: new Array(64).fill(0), score: 0, lines: 0, i: 0 }, grid = el("div", "bgrid"), info = el("p", "lbl", ""), shapes = el("div", "bnext"), cells = [];
    function mini(b) { var m = el("div", "bmini"); b.forEach(function (c) { var i = el("i"); i.style.gridColumn = c[0] + 1; i.style.gridRow = c[1] + 1; m.appendChild(i); }); return m; }
    function show() {
      cells.forEach(function (c, i) { c.classList.toggle("on", !!st.grid[i]); });
      info.textContent = say("blk_score", { n: st.score }); shapes.textContent = "";
      shapes.appendChild(el("span", "", L().blk_now)); shapes.appendChild(mini(Tn.blockAt(doc, st.i))); shapes.appendChild(el("span", "", L().blk_next)); shapes.appendChild(mini(Tn.blockAt(doc, st.i + 1)));
    }
    function end() { set(moves.slice()); }
    for (var i = 0; i < 64; i++) (function (i) {
      var c = el("button", "bcell", null, function () {
        var b = Tn.blockAt(doc, st.i);
        if (!Tn.fits(st.grid, b, i)) { Kit.tone(200, 90, 0.08, "square", 0.05); return; }
        st = Tn.drop(st, b, i); moves.push(i); show(); Kit.sfx.tap();
        if (st.lines) { Kit.sfx.pop(); Kit.haptic(st.lines > 1 ? 50 : 20); if (st.lines > 1) Kit.toast(L().blk_combo + " x" + st.lines); }
        if (moves.length >= p.max || !Tn.canMove(st, doc)) end();
      });
      c.setAttribute("aria-label", String(i + 1)); cells.push(c); grid.appendChild(c);
    })(i);
    box.appendChild(info); box.appendChild(shapes); box.appendChild(grid); box.appendChild(el("button", "chip", L().blk_end, end));
    show(); set(null);
  },
  alloc: function (box, p, set, ctx) {
    var items = p.from(ctx.doc, ctx.m, ctx.now, Kit.lang), vals = p.vals ? p.vals(ctx.doc) : null, bids = items.map(function () { return 0; }), left = el("p", "lbl", "");
    function sum() { return bids.reduce(function (a, b) { return a + b; }, 0); }
    function up() { left.textContent = say("left", { n: p.sum - sum() }); set(bids.slice()); }
    items.forEach(function (s, i) {
      box.appendChild(el("p", "lbl", vals ? s + " · " + vals[i] : s));
      var row = el("div", "chips"), n = el("b", "", "0");
      var less = el("button", "chip", "−", function () { if (bids[i] >= p.step) { bids[i] -= p.step; n.textContent = bids[i]; up(); Kit.sfx.tap(); } });
      var more = el("button", "chip", "+", function () { if (sum() + p.step <= p.sum) { bids[i] += p.step; n.textContent = bids[i]; up(); Kit.sfx.tap(); } });
      less.setAttribute("aria-label", say("a_less", { s: s })); more.setAttribute("aria-label", say("a_more", { s: s }));
      row.appendChild(less); row.appendChild(n); row.appendChild(more);
      box.appendChild(row);
    });
    box.appendChild(left); up();
  },
  // The shopping list: one field, Enter adds ("2× Milch" counts 2). Each row: I'll bring it, or bought. set() gets the whole list as
  // it would go out: what came in, merged with this phone's copy, plus this person's changes. Text only ever goes in as textContent.
  shop: function (box, p, set, ctx) {
    var cf = p.cfg, K = p.k || "ein", W = function (x) { return L()[K + "_" + x] || L()["ein_" + x]; };
    var base = ctx.m.length ? ctx.m[0][0] : null, e = ctx.ed.shop || (ctx.ed.shop = { name: "", face: myFace(), adds: [], marks: {} });
    var form = el("form", "shopadd"), f = el("input", "field"), plus = el("button", "chip", "+"), rows = el("div", "shoplist"), who = el("input", "field"), pn = document.getElementById("panel");
    if (pn) pn.dataset.size = "big";
    f.maxLength = cf ? cf.text + 4 : 40; f.autocomplete = "off"; f.enterKeyHint = "enter"; f.placeholder = W("ph"); f.setAttribute("aria-label", W("field"));
    plus.type = "submit"; plus.setAttribute("aria-label", W("add"));
    who.maxLength = 12; who.autocomplete = "off"; who.setAttribute("aria-label", W("name")); who.placeholder = L().ter_name;
    var nick = A.me().nick; if (!e.name && nick && Tn.nameOk(nick)) e.name = nick; who.value = e.name;
    function now() { return Tn.shopApply(base, e, cf); }
    // a task is its text (no count in front); a shopping item may start with a count
    function parse(v) { if (!cf || !cf.due) return Tn.shopParse(v); var x = Q.clean(v, cf.text); return x && Tn.shopKey(x) ? { text: x, qty: 0 } : null; }
    function named() { return Tn.nameOk(e.name); }
    function people(l) { return l.map(function (x) { return Tn.FACES[x[1]] + " " + x[0]; }).join(", "); }
    function sent(k) { return !!base && base[1].some(function (it) { return Tn.shopKey(it[0]) === k; }); }
    function mark(k, s) {
      if (!named()) { Kit.toast(L().ein_need_name); who.focus(); who.classList.add("nudge"); setTimeout(function () { who.classList.remove("nudge"); }, 700); return; }
      e.marks[k] = s; Kit.sfx.tap(); up();
    }
    function row(r, v) {
      var me = named() ? Tn.shopMark(v, e.name, r.key) % 3 : 0, d = el("div", "shoprow" + (r.bought.length ? " done" : "")), txt = el("div", "shoptext");
      txt.appendChild(el("b", "", r.label));
      var line = [r.bought.length ? say(K + "_got", { n: people(r.bought) }) : r.bring.length ? say(K + "_brings", { n: people(r.bring) }) : cf && cf.due ? L().tdo_open : "", r.due ? Tn.dueText(r.due, Kit.lang) : ""].filter(Boolean).join(" · ");
      if (line) txt.appendChild(el("small", "", line));
      d.appendChild(txt);
      [[1, "🙋", K + "_bring"], [2, "✓", K + "_bought"]].forEach(function (x) {
        var b = el("button", "chip" + (me === x[0] ? " on" : ""), x[1], function () { mark(r.key, me === x[0] ? 0 : x[0]); });
        b.setAttribute("aria-label", L()[x[2]] + ": " + r.label); b.setAttribute("aria-pressed", String(me === x[0])); d.appendChild(b);
      });
      if (!sent(r.key)) {
        var x = el("button", "chip", "✕", function () { e.adds = e.adds.filter(function (a) { return Tn.shopKey(a.text) !== r.key; }); delete e.marks[r.key]; Kit.sfx.tap(); up(); });
        x.setAttribute("aria-label", W("drop") + ": " + r.label); d.appendChild(x);
      }
      return d;
    }
    function up() {
      var v = now();
      rows.textContent = "";
      if (!v[1].length) rows.appendChild(el("p", "note", W("empty")));
      Tn.shopRows(v, cf).forEach(function (r) { rows.appendChild(row(r, v)); });
      set(Tn.shopOk(v, cf) ? v : null);
    }
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var a = parse(f.value); if (!a) { if (f.value.trim()) Kit.toast(t("filter")); return; }
      var k = Tn.shopKey(a.text), had = now()[1].filter(function (it) { return Tn.shopKey(it[0]) === k; })[0];
      f.value = ""; f.focus();
      if (had && had[2] >= a.qty) { Kit.toast(W("have")); return; }
      e.adds.push(a);
      if (!now()[1].some(function (it) { return Tn.shopKey(it[0]) === k; })) { e.adds.pop(); f.value = a.qty > 1 ? a.qty + "× " + a.text : a.text; Kit.toast(W("full")); return; }
      Kit.sfx.pop(); up();
    });
    who.addEventListener("input", function () { e.name = who.value.trim(); up(); });
    form.appendChild(f); form.appendChild(plus); box.appendChild(form); box.appendChild(rows);
    box.appendChild(el("label", "lbl", W("name"))); box.appendChild(who);
    box.appendChild(el("p", "note", W("hint")));
    if (cf && cf.due) todoTools(box, ctx.doc, now);
    up();
  },
  // The time is picked once, then every tapped day adds that time. Dates are taps, never text.
  slots: function (box, p, set, ctx) {
    var pre = ctx && ctx.ed.pre && ctx.ed.pre.slots, today = localDay(), picked = pre ? pre.slice(0, 5) : [], h = picked.length ? picked[0] % 10 : 6, times = el("div", "chips"), days = el("div", "chips"), mine = el("div", "chips"), name = nameField(up);
    function up() {
      picked.sort(function (a, b) { return a - b; });
      Array.from(times.children).forEach(function (b, i) { b.classList.toggle("on", i === h); });
      Array.from(days.children).forEach(function (b, i) { b.classList.toggle("on", picked.indexOf((today + i) * 10 + h) >= 0); });
      mine.textContent = "";
      picked.forEach(function (s) { mine.appendChild(el("button", "chip on", Tn.slotText(s, Kit.lang) + " ✕", function () { picked.splice(picked.indexOf(s), 1); Kit.sfx.tap(); up(); })); });
      var v = [name.value.trim(), picked.slice()]; set(p.ok(v, []) ? v : null);
    }
    Tn.HOURS.forEach(function (x, i) { times.appendChild(el("button", "chip", Tn.hourText(i, Kit.lang), function () { h = i; Kit.sfx.tap(); up(); })); });
    for (var k = 0; k < 14; k++) (function (s) {
      days.appendChild(el("button", "chip", Tn.dayText(Math.floor(s / 10), Kit.lang), function () {
        var at = picked.indexOf(s + h);
        if (at >= 0) picked.splice(at, 1); else if (picked.length >= 5) { Kit.toast(L().ter_max); return; } else picked.push(s + h);
        Kit.sfx.tap(); up();
      }));
    })((today + k) * 10);
    box.appendChild(el("label", "lbl", L().ter_time)); box.appendChild(times);
    box.appendChild(el("label", "lbl", L().ter_days_l)); box.appendChild(days);
    box.appendChild(el("label", "lbl", L().ter_chosen)); box.appendChild(mine);
    box.appendChild(el("label", "lbl", L().ter_name)); box.appendChild(name); up();
  },
  // Name and an answer per date on one screen. No answer is set in advance: a silent no would look like a real one.
  vote: function (box, p, set, ctx) {
    var list = Tn.termDates(ctx.m), v = list.map(function () { return -1; }), rows = [], taken = el("p", "note", ""), name = nameField(up);
    function up() {
      rows.forEach(function (r, i) { Array.from(r.children).forEach(function (b, k) { b.classList.toggle("on", v[i] === k); }); });
      var a = [name.value.trim(), v.slice()], f = Q.fold(a[0]);
      taken.textContent = f && Tn.voted(ctx.m).some(function (x) { return Q.fold(x) === f; }) ? L().ter_taken : "";
      set(v.every(function (x) { return x >= 0; }) && p.ok(a, ctx.m) ? a : null);
    }
    box.appendChild(el("label", "lbl", L().ter_name)); box.appendChild(name); box.appendChild(taken);
    box.appendChild(el("button", "chip", L().ter_all_yes, function () { v = v.map(function () { return 0; }); Kit.sfx.tap(); up(); }));
    list.forEach(function (s, i) {
      var row = el("div", "chips");
      box.appendChild(el("p", "lbl", Tn.slotText(s, Kit.lang)));
      [L().ter_yes, L().ter_maybe, L().ter_no].forEach(function (w, k) { row.appendChild(el("button", "chip", w, function () { v[i] = k; Kit.sfx.tap(); up(); })); });
      rows.push(row); box.appendChild(row);
    });
    box.appendChild(el("p", "note", L().ter_hint)); up();
  }
};
// Under a task list: the open deadlines as a calendar file, and the next meeting's agenda from the open tasks (no AI).
function todoTools(box, doc, now) {
  var row = el("div", "chips"), out = el("div", "todoagenda"), title = doc.t || L().tdo_title;
  row.appendChild(el("button", "chip", L().tdo_ics, function () {
    var ics = Tn.todoIcs(now(), title, Kit.lang); Kit.sfx.tap();
    if (!ics) { Kit.toast(L().tdo_ics_none); return; }
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" })); a.download = "aufgaben.ics";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }));
  row.appendChild(el("button", "chip", L().tdo_next, function () {
    Kit.sfx.tap(); out.textContent = "";
    var text = Tn.todoAgenda(now(), title, Kit.lang);
    out.appendChild(el("p", "agendatext", text));
    out.appendChild(el("button", "chip", L().tdo_copy, async function () { if (await Kit.copy(text)) Kit.toast(t("copied")); }));
  }));
  box.appendChild(row); box.appendChild(out);
}
// "Wer sieht was?" and the card's notes before the action: one line in sight (lead, cut after its first sentence, or after
// the first two when it starts with the question "Wer sieht was?"), all of it under "ⓘ Mehr".
function brief(box, lead, list, two) {
  var d = el("details", "more");
  if (!list.length) return;
  box.appendChild(el("p", "note", String(lead).replace(two ? /^(.+?[.!?]\s.+?[.!?])\s.*$/ : /^(.+?[.!?])\s.*$/, "$1"))); d.appendChild(el("summary", "", "ⓘ " + t("mehr")));
  list.forEach(function (x) { d.appendChild(typeof x === "string" ? el("p", "note", x) : x); }); box.appendChild(d);
}
// A known age band under 18 (my defaults); an adult build never asks.
function minor() { var f = A.me().pref; return !D.adult(A.me()) && !!f && (f.age === "u16" || f.age === "u18"); }
// The calendar day on this phone, counted like Turns.today but from local midnight.
function localDay() { return Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000); }
// A name field filled with the profile's nick when the filter lets it through.
function nameField(up) {
  var f = el("input", "field"), nick = A.me().nick;
  f.maxLength = 12; f.autocomplete = "off"; f.setAttribute("aria-label", L().ter_name); f.placeholder = L().ter_name;
  if (nick && Q.clean(nick, 12) === nick) f.value = nick;
  f.addEventListener("input", function () { up(); });
  return f;
}
// The next move on the same phone: nobody sees the last one, the phone changes hands first.
function pass(box, ed) {
  var d = ed.next; if (!d) return; ed.next = null; ed.doc = d; A.changed();
  if (Tn.state(d).over) { A.tab("Move"); return; }
  box.textContent = ""; box.appendChild(el("p", "qtext", L().hand));
  box.appendChild(el("button", "btn hot", L().hand_go, function () { Kit.sfx.tap(); walk(box, ed); }));
}
// Satz zu Formular (satz-ui.js, its own part): one tap above the first step opens it. It fills the step below (ed.pre, the
// shopping list's own changes) after the person checked it; it never sends a move by itself.
var SATZ = { termin: 1, einkauf: 1, wichteln: 1, reihum: 1, aufgaben: 1 };
function satz(box, ed) {
  var w = el("div", "satz"), b = el("button", "btn satzgo", "✨ " + L().satz_go, function () {
    Kit.sfx.tap(); b.disabled = true;
    window.Parts.use("satz", function () { b.remove(); window.SatzUI.open(w, ed, function () { A.tab("Move"); }); }).catch(function () { b.disabled = false; });
  });
  w.appendChild(b); box.appendChild(w);
}
// A step that only hands over or shows (paying, a sealed slip): no main button. end may depend on the moves.
function ends(p, doc) { return typeof p.end === "function" ? p.end(doc, Tn.moves(doc)) : p.end; }
// Goes through the turn's prompts one by one; each screen shows only what that step may know. "Weiter" is the footer's
// main button (ed.step): locked until the step has an answer, so it never hides below the fold of the panel.
function walk(box, ed) {
  var st = Tn.state(ed.doc), now = [], i = 0;
  function step() {
    ed.step = null;
    box.textContent = ""; box.style.pointerEvents = "none"; setTimeout(function () { box.style.pointerEvents = ""; }, 250);
    if (i >= st.prompts.length && Tn.game(ed.doc).stay && st.turn) { ed.next = null; A.changed(); box.appendChild(el("p", "lbl", L().stay_note)); return; }   // the same link goes on to the next person
    if (i >= st.prompts.length) { ed.move = now; ed.next = Tn.play(ed.doc, now, Tn.today());
      if (Tn.game(ed.doc).local || (ed.next && Tn.state(ed.next).over)) { pass(box, ed); return; }
      A.changed(); box.appendChild(el("p", "lbl", L()[word(ed.doc, "ready")])); box.appendChild(el("button", "btn", L().hand_same, function () { pass(box, ed); })); return; }
    var p = st.prompts[i], at = i, cur = null, me = { box: box, live: !!p.live, ok: function () { return cur !== null; },
      why: t("whyOpen", { s: ask(p, ed.doc, st.moves) }), go: go };
    function go() {   // the main button takes no tap for a moment: the second tap of a double tap does not take the next step too
      if (cur === null || ed.step !== me || !box.isConnected) return; Kit.sfx.pop(); now.push(cur); cur = null; i++;
      var b = document.getElementById("edmain"); b.style.pointerEvents = "none"; setTimeout(function () { b.style.pointerEvents = ""; }, 250);
      step(); A.footer();
    }
    if (i === 0 && SATZ[ed.doc.g] && (!st.turn || p.live)) satz(box, ed);
    if (p.peek) { var pe = box.appendChild(el("p", "qtext", p.peek(ed.doc, st.moves, now, Kit.lang))); if (p.dp) pe.dataset.part = p.dp; }
    if (!p.top || p.w !== "pick" || !p.auto) box.appendChild(el("h3", "lbl", p.title ? p.title(ed.doc, Kit.lang) : L()[p.l].replace(": {q}", "")));
    var soon = 0, dw = draw[p.w] || (window.Turn2 && window.Turn2.get("widget", p.w));
    if (!dw) {   // its part: until it is there the main button stays locked and says why; a part that failed can be tried again
      var miss = el("p", "note", "…"); box.appendChild(miss); ed.step = { box: box, ok: function () { return false; }, why: t("part_wait"), go: function () {} }; A.footer();
      var P = window.DailyParts || {}, part = Object.keys(P).filter(function (n) { return P[n].g && P[n].g.indexOf(ed.doc.g) >= 0; })[0] || "turnzwei";   // the game's part in the manifest
      window.Parts.use(part, function () { if (box.isConnected && i === at) step(); }).catch(function () {
        if (!box.isConnected || i !== at) return; miss.textContent = ed.step.why = t("part_fail"); A.footer(); box.appendChild(el("button", "btn", t("retry"), function () { Kit.sfx.tap(); step(); }));
      });
      return;
    }   // a widget of the new cards, from its part
    dw(box, p, function (v) {
      if (p.live) { ed.next = v === null ? null : Tn.play(ed.doc, [v], Tn.today()); A.changed(); return; }   // no Weiter: the footer sends what is on screen
      cur = v; clearTimeout(soon); A.footer();
      var auto = ed.pre && ed.pre.go; if (auto) ed.pre.go = 0;      // taken from a sentence and complete: on at once, only this once
      if (v === null) return;
      if (auto) setTimeout(function () { if (cur === v) go(); }, 0);
      if (p.auto) go(); else if (p.w === "rank" || (p.w === "pick" && p.n > 1)) soon = setTimeout(function () { if (box.isConnected && cur === v) go(); }, 450);   // a short look at the choice, then on
    }, { doc: ed.doc, m: st.moves, now: now, ed: ed });
    if (!ends(p, ed.doc) && box.isConnected && i === at) { ed.step = me; A.footer(); }   // unless the step already went on by itself
  }
  step();
}
// The date that leads so far as a calendar file (satz-ui.js builds it on the device).
function icsRow(p, doc) {
  var w = el("div", "satz"); w.appendChild(el("button", "chip", "📅 " + L().satz_ics, function () { Kit.sfx.tap(); window.Parts.use("satz", function () { window.SatzUI.ics(doc); }).catch(function () {}); }));
  p.appendChild(w);
}
A.TABS.turn = ["Move", "Text", "Color"];
A.PANEL.Move = function (p) {
  var ed = A.ed(); ed.step = null;
  var doc = ed.doc, gm = Tn.game(doc), g = gm;
  // A game whose texts come with a part (GAMES[g].part, e.g. the quiz cards of quizspiele.js): load it first, then draw.
  if (gm.part && !window.Parts.ready(gm.part)) {
    p.appendChild(el("p", "note", t("part_wait")));
    window.Parts.use(gm.part, function () { if (A.ed() === ed) A.tab("Move"); }).catch(function () { if (A.ed() === ed && p.isConnected) p.lastChild.textContent = t("part_fail"); });
    return;
  }
  var st = Tn.state(doc), left = Tn.gate(doc, Tn.today()), res = Tn.result(doc, Kit.lang);
  // New cards (Katalog v2, rules 16, 19): "Wer sieht was?" and the card's notes below the steps, which never clear them.
  if (g.wsw || g.notes) {
    var foot = el("div", "turnfoot"), top = el("div"); p.appendChild(top); p.appendChild(foot); p = top;
    var n = (g.notes || []).map(function (k) { return L()[k]; });
    brief(foot, g.wsw ? t("wsw_h") + " " + window.Bausteine.wsw(g.wsw) : n[0] || "", (g.wsw ? [window.Bausteine.wswRow(g.wsw)] : []).concat(n), !!g.wsw);
  }
  if (res) {
    p.appendChild(el("p", "qtext", res.h)); res.lines.forEach(function (s) { p.appendChild(el("p", "note", s)); });
    if (doc.g === "termin") icsRow(p, doc);
    if (res.copy) { p.appendChild(el("button", "btn hot", L().sor_copy, async function () { if (await Kit.copy(res.copy)) Kit.toast(t("copied")); })); p.appendChild(el("p", "note", res.note)); return; }
    if (res.note) p.appendChild(el("p", "note", res.note));
    var nx = res.open && D.byId(res.open.i);   // a card to go on with, e.g. collecting the money for a gift
    if (nx) p.appendChild(el("button", "btn", L()[res.open.l], function () { Kit.sfx.tap(); A.openEditor(D.docFromIdea(nx, A.me(), Kit.lang), { idea: nx }); }));
    p.appendChild(el("button", "btn hot", L()[word(doc, "rematch")], function () { var d = Tn.fresh(doc, seed()); A.openEditor(d, { idea: d.i ? D.byId(d.i) : null }); }));
    return;
  }
  if (left) { p.appendChild(el("p", "qtext", say("note_wait", { n: left }))); return; }
  var w = Tn.whole(doc, Kit.lang); if (w) p.appendChild(el("p", "qtext", w));
  if (doc.g === "termin" && st.moves.length) { icsRow(p, doc); var inner = el("div"); p.appendChild(inner); p = inner; }   // walk() clears its box
  if (ed.next && !st.prompts.some(function (x) { return x.live; })) { p.appendChild(el("p", "lbl", L()[word(doc, "ready")])); p.appendChild(el("button", "btn", L().redo, function () { ed.next = null; A.changed(); A.tab("Move"); })); return; }
  // Quiz cards: a question pack (part "quiz") before the first move; Team- and Typen-Quiz need one.
  if (!st.turn && window.QuizPack.GAMES[doc.g]) {
    p.appendChild(el("button", "btn qzbtn", "📦 " + (doc.pk ? doc.pk.t + " · " + L().pk_change : L().pk_btn), function () { Kit.sfx.tap(); window.Parts.use("quiz", function () { window.QuizUI.open(ed); }).catch(function () {}); }));
    if (Tn.GAMES[doc.g].needs && !doc.pk) { p.appendChild(el("p", "note", L().pk_need)); return; }
    var box = el("div"); p.appendChild(box); p = box;
  }
  walk(p, ed);
};
// The text tab of every other kind is the one of the part blasen (src/blasen.js): it comes with the editor, after this file.
A.PANEL.Text = (function () {
  return function (p) {
    if (A.ed().doc.k !== "turn") { window.Blasen.PANEL.Text(p); return; }
    var d = A.ed().doc;
    A.field(p, t("ideaT"), d.t, 40, function (v) { d.t = v; });
    A.field(p, t("ideaS"), d.s, 70, function (v) { d.s = v; });
    if (d.g === "deal") A.field(p, L().things, d.w, 14, function (v) { if (v) d.w = v; else delete d.w; });   // only the deal speaks of its things
    if (!A.allow("tools", "shapes")) return;   // a flavor whose picture has no shapes (Business)
    // the shape that flies across the card, each drawn as on the card, with its name
    p.appendChild(el("h3", "lbl", L().fly));
    var box = el("div", "chips"), N = L().shp.split("|");
    Tn.SHAPES.forEach(function (f, i) {
      var c = document.createElement("canvas"), x = c.getContext("2d"), b = el("button", "chip", null, function () { d.f = f; A.changed(); A.tab("Text"); var x = document.querySelector('#panel [aria-label="' + N[i] + '"]'); if (x) x.focus(); });
      c.width = c.height = 30; x.fillStyle = d.col[0]; x.fillRect(0, 0, 30, 30); shape(x, f, 15, 15, 11, d.col[1]);
      b.appendChild(c); b.setAttribute("aria-label", N[i]); press(b, d.f === f); box.appendChild(b);
    });
    p.appendChild(box);
  };
})();
X.turn = {
  // Every game on one shelf, each with what it is for.
  // Every game on one shelf as a tile with its own sign, grouped by when it fits, plus one button for a surprise.
  menu: function () {
    var all = D.IDEAS.filter(function (i) { return i.kind === "turn"; }), COL = { streit: "#ff3b1d", pause: "#1d7cff", abend: "#7a3bff", geschenk: "#ff5fa2", raum: "#12a150" };
    // a card whose rule comes in a part (turnzwei, malen) waits for it
    function start(i) { var n = A.part(i); if (n) { window.Parts.use(n, function () { start(i); }).catch(function () {}); return; } Kit.sfx.thud(); A.openEditor(D.docFromIdea(i, A.me(), Kit.lang), { idea: i }); }
    var arcade = window.ArcadeUI ? window.ArcadeUI.count() : 0;
    A.shelf(say("turn_all", { n: all.length + arcade }), function (b) {
      b.appendChild(el("p", "note", t("turnH")));
      // Shelf clean-up 2026-11: Ballduell live went into Stangen-Kick and Doppelkopf into the Skat table (their links still open).
      // The arcade tiles come with their part (parts.js): a slot keeps their place on the shelf until then.
      if (arcade) { var slot = el("div", ""); slot.style.display = "contents"; b.appendChild(slot); window.ArcadeUI.tiles(slot); }
      if (window.TableUI && window.LiveUI && window.LiveUI.on()) [["skat", "tb_skat"]].forEach(function (g) { b.appendChild(el("button", "btn hot live", t(g[1]), function () { Kit.sfx.thud(); window.TableUI.open(g[0]); })); });
      if (window.TableUI) b.appendChild(el("button", "btn hot", t("tb_bauernskat"), function () { Kit.sfx.thud(); window.TableUI.open("bauernskat"); }));   // also offline, against the bot
      b.appendChild(el("button", "btn hot", "🎲 " + L().turn_any, function () { start(all[seed() % all.length]); }));
      ["streit", "pause", "abend", "geschenk", "raum"].forEach(function (g) {
        b.appendChild(el("label", "lbl", L()["grip_" + g]));
        var box = el("div", "tiles");
        all.filter(function (i) { return i.turn.grip === g; }).forEach(function (i) {
          var T = i[Kit.lang] || i.de, m = el("button", "mech tile", null, function () { start(i); }), c = document.createElement("canvas");
          c.width = c.height = 96; shape(c.getContext("2d"), i.turn.f, 48, 48, 30, COL[g]);
          m.appendChild(c); m.appendChild(el("b", "", D.plainTitle(T.t))); m.appendChild(el("small", "", T.s)); box.appendChild(m);
        });
        b.appendChild(box);
      });
    });
  },
  open: function (ed) {
    ed.next = null; if (!Tn.state(ed.doc).turn) { ed.doc.seed = Tn.GAMES[ed.doc.g].daily ? Tn.today() : seed(); ed.base.seed = ed.doc.seed; ed.doc.q = ""; ed.base.q = ""; }
    if (listOf(ed.doc)) shopSync(ed);
  },
  areas: function (ed) { return ed.next ? ["regeln"] : []; },
  // The main button is the next step ("Weiter", locked until answered), then sending; with nothing to do here
  // (waiting for a day, a pack to pick, the phone to pass on) there is no button at all rather than a dummy one.
  footer: function (b, ed) {
    var over = !!Tn.result(ed.doc, Kit.lang), s = !over && ed.step, walking = s && !s.live && !ed.next;
    b.hidden = (ed.doc.g === "sorry" && over) || Tn.state(ed.doc).prompts.some(function (p) { return ends(p, ed.doc); }) || (!over && !ed.next && !s);   // a last step that only hands over, like paying
    b.classList.toggle("wait", walking ? !s.ok() : !over && !ed.next);
    b.textContent = over ? L().result_pic : walking ? L().next : L()[word(ed.doc, "send")];
    if (s) b.dataset.why = s.why;
  },
  nudge: function (ed) { if (ed.step && !ed.step.box.isConnected) A.tab("Move"); return false; },
  main: function (ed) {
    var over = !!Tn.result(ed.doc, Kit.lang), s = ed.step;
    if (!over && s && !s.live && !ed.next) { if (!s.box.isConnected) A.tab("Move"); else s.go(); return; }
    if (!over && !ed.next) return;
    if (!over && listOf(ed.doc)) {   // the list on screen in the colours and words chosen since; what goes out is what this phone knows now
      ed.next = Tn.play(ed.doc, [Tn.moves(ed.next)[0][0]], Tn.today()) || ed.next; shopKeep(ed.next, Tn.moves(ed.next)[0][0]);
    }
    Kit.sfx.thud(); A.finish(over ? ed.doc : ed.next);
  },
  label: function (doc) {
    var st = Tn.state(doc), left = Tn.gate(doc, Tn.today());
    if (st.over) return { go: L().go_view, note: L()[word(doc, "note_over")] };
    if (left) return { go: L()[word(doc, "go_play")], note: say("note_wait", { n: left }) };
    return st.turn ? { go: L()[word(doc, "go_play")], note: say(word(doc, "note_turn"), { n: st.turn + 1, m: st.total, v: st.turn }) } : { go: L()[word(doc, "go_first")], note: "" };
  }
};
})();
