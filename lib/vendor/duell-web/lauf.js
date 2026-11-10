// My Daily Idea: the second game engine's document (doc.k "lauf"): a side-scrolling world with gravity, jumps, gaps,
// obstacles, coins and foes. Only the data and its rules live here (core, and vendored by the server, CADS-DEMO-wrapper
// lib/vendor/duell-web): the engine itself (physics, generator, picture, editor) is the part "lauf" (src/lauf-engine.js,
// src/lauf-ui.js). A game is a small JSON object the AI can fill by schema and a link can carry:
// { ev?: engine version, m: mode, seed, w: world, e: figure, o: obstacle, c: coin, f: foe, fp: foe patterns, p: numbers (SPEC),
//   r?: score to beat }
// A new kind of game is new numbers here (e.g. dodging from above: fa high, the rest low), not new code.
(function (root) {
  "use strict";
  // name: [min, max, default]. g gravity, j jump speed, v start speed, a speed gain per 1000 px, vm top speed (px/s);
  // the rest are chances in % per stretch: lu gap, hi obstacle, du bar to duck under, mu coins, ge foe, fa falling from above;
  // lw gap width in % of the safe jump, hv height changes, len distance to the goal in m (mode "ziel")
  var SPEC = { g: [900, 3200, 2000], j: [400, 1000, 680], v: [100, 420, 190], a: [0, 40, 8], vm: [120, 520, 360], lu: [0, 80, 35], lw: [20, 100, 75],
    hi: [0, 90, 40], du: [0, 60, 0], mu: [0, 100, 50], ge: [0, 80, 20], fa: [0, 80, 0], hv: [0, 100, 30], len: [100, 3000, 600] };
  // the engine version a doc was made for (src/lauf-engine.js): 1 = deterministic run (fixed-point flying path, inputs at
  // the tick). A doc without ev is version 0 and keeps its old run, so links from before play as they did. A newer
  // version than EV is kept as it is (shared on, it stays what it was); this app plays it with its newest run. New docs
  // (build(), the editor) get EV.
  var EV = 1;
  var MODES = ["endlos", "ziel"], WORLDS = ["bruecke", "stadt", "wald", "wueste", "eis", "nacht", "lava", "candy"], PATTERNS = ["geh", "huepf", "flug"];
  var FIG = ["🏃", "🐸", "🦊", "🐱", "🐶", "🦖", "🐧", "🐰", "🤖", "👾", "🦄", "🐢", "🐹", "🦝", "🐼", "🐵"];
  var OBJ = ["📦", "🪨", "🌵", "🧱", "🍄", "🪵", "🧊", "🔥", "🌲", "🎁", "⛄", "🎃"];
  var COIN = ["🪙", "⭐", "💎", "🍎", "🍓", "🍩", "🍪", "🥕", "🍒", "🌟", "💛", "🍬"];
  var FOE = ["🐌", "🦀", "🐝", "🦇", "🐞", "🦔", "👻", "🐙", "🐦", "🦆", "🐭", "🐊"];
  function one(list, v) { return list.indexOf(v) >= 0 ? v : list[0]; }
  function sanitize(o) {
    o = o && typeof o === "object" ? o : {};
    var p = o.p && typeof o.p === "object" ? o.p : {}, q = {};
    Object.keys(SPEC).forEach(function (k) { var s = SPEC[k], n = Math.round(Number(p[k])); q[k] = p[k] != null && isFinite(n) ? Math.min(s[1], Math.max(s[0], n)) : s[2]; });
    q.vm = Math.max(q.vm, q.v);
    // the highest jump stays inside the picture (about 250 px of the 360)
    q.j = Math.min(q.j, Math.floor(Math.sqrt(300 * q.g)));
    var fp = PATTERNS.filter(function (x) { return Array.isArray(o.fp) && o.fp.indexOf(x) >= 0; });
    var l = { m: one(MODES, o.m), seed: Number.isInteger(o.seed) && o.seed >= 0 && o.seed <= 4294967295 ? o.seed : 1, w: one(WORLDS, o.w), e: one(FIG, o.e), o: one(OBJ, o.o), c: one(COIN, o.c), f: one(FOE, o.f), fp: fp.length ? fp : ["geh"], p: q };
    if (Number.isInteger(o.r) && o.r > 0 && o.r < 1e6) l.r = o.r;
    if (Number.isInteger(o.ev) && o.ev >= 1 && o.ev < 1e3) l.ev = o.ev;
    return l;
  }
  var api = { EV: EV, SPEC: SPEC, MODES: MODES, WORLDS: WORLDS, PATTERNS: PATTERNS, FIG: FIG, OBJ: OBJ, COIN: COIN, FOE: FOE, sanitize: sanitize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Lauf = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
