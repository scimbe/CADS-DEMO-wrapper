// My Daily Idea: the second game engine (part "lauf"), pure logic without DOM: runner and platformer. Same doc (src/lauf.js)
// + same presses at the same ticks = same run; every piece of the track comes from the doc's seed, never from Math.random.
// The track is made stretch by stretch in front of the runner; each gap is at most SAFE of the farthest jump at the speed
// the runner has there (the speed grows with the distance only, so it is known in advance), each step up and each block
// lower than the highest jump. Also run by the server (vendored) for build(): the AI's slots -> a doc's game.
(function (root) {
  "use strict";
  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./core.js") : root.DuellCore, L = node ? require("./lauf.js") : root.Lauf;
  // the world in px: view height H, ground level GY, runner width PW, height PH (ducked DH), fixed step, jump hold
  var H = 360, GY = 280, YMIN = 170, YMAX = 310, PW = 26, PH = 40, DH = 22, STEP = 1 / 120, HOLD = 0.24, HOLDG = 0.42, TERM = 1100, COY = 0.09, BUF = 0.12, SAFE = 0.8, AHEAD = 1600;
  function speedAt(p, x) { return Math.min(p.vm, p.v + p.a * Math.max(0, x) / 1000); }
  // one step of the vertical motion, the same for the run and for the jump table below
  function vert(b, held, g) {
    var m = held && b.ht > 0 && b.vy < 0 ? HOLDG : 1;
    b.ht -= STEP; b.vy = Math.min(b.vy + g * m * STEP, TERM); b.y += b.vy * STEP;
  }
  // the highest jump (held all the way): height above the take-off for each tick, until it is 500 below
  function arc(p) {
    var b = { y: 0, vy: -p.j, ht: HOLD }, up = [];
    while (b.y < 500 && up.length < 4000) { vert(b, true, p.g); up.push(-b.y); }
    return up;
  }
  function jumps(p) {
    var up = arc(p), top = Math.max.apply(null, up);
    return {
      top: top,
      // time in the air until the runner is back at height h above the take-off (h > top: never)
      air: function (h) { for (var i = up.length - 1; i >= 0; i--) if (up[i] >= h) return (i + 1) * STEP; return 0; },
      // time spent at h or higher
      above: function (h) { var n = 0; for (var i = 0; i < up.length; i++) if (up[i] >= h) n++; return n * STEP; }
    };
  }
  function createSim(l) {
    l = L.sanitize(l);
    var p = l.p, rng = C.mulberry32(l.seed), J = jumps(p), r = function () { return rng(); };
    var s = { l: l, p: p, J: J, H: H, PW: PW, state: "ready", ticks: 0, coins: 0, stomps: 0, held: false, duck: false,
      me: { x: 0, y: GY, vy: 0, ht: 0, on: true, coy: 0, want: 0 }, spans: [], items: [], goal: l.m === "ziel" ? l.p.len * 10 : 0, end: false };
    var gx = -300, gy = GY, n = 0;
    function put(it) { s.items.push(it); return it; }
    // the hazards and coins of one stretch, left to right, one jump apart
    function fill(sp) {
      var v = speedAt(p, sp.x0), gapS = v * J.air(0) * 1.15 + 70, x = sp.x0 + (n === 1 ? 900 : 150), stop = sp.x1 - 130 - v * 0.25;
      var hz = [p.hi, p.du, p.ge, p.fa], sum = hz.reduce(function (a, b) { return a + b; }, 0);
      for (; x < stop; x += gapS * (1 + r() * 0.6)) {
        var u = r() * Math.max(100, sum), k = -1;
        for (var i = 0, c = 0; i < 4; i++) { c += hz[i]; if (u < c) { k = i; break; } }
        var w = 28 + r() * 14, h = 18 + r() * (Math.min(60, J.top * 0.55) - 18);
        // a block must be clearable: long enough above its height at this speed
        while (h > 10 && J.above(h + 4) * speedAt(p, x) < w + PW + 24) h -= 4;
        if (k === 0 && h > 10) put({ t: "o", x: x, y: sp.y - h, w: w, h: h });
        else if (k === 1) put({ t: "d", x: x, y: sp.y - 420, w: 50 + r() * 50, h: 420 - 28 });
        else if (k === 2) {
          var f = l.fp[Math.floor(r() * l.fp.length)];
          put({ t: "f", k: f, x: x, x0: sp.x0 + 10, x1: sp.x1 - 10, y: f === "flug" ? sp.y - 64 : sp.y - 26, base: sp.y, w: 26, h: 26, vx: -40, vy: 0, ph: r() * 6.28, live: true });
        } else if (k === 3 && h > 10) put({ t: "x", x: x, y: -60, to: sp.y - Math.min(30, h), w: Math.min(30, h), h: Math.min(30, h), vy: 0, at: x - speedAt(p, x) * 1.2, go: false });
        if (r() * 100 < p.mu) {
          var cy = sp.y - 24 - r() * Math.min(100, J.top * 0.7), cn = 3 + Math.floor(r() * 3);
          for (var j = 0; j < cn; j++) put({ t: "c", x: x + gapS * 0.5 + j * 30 - cn * 15, y: cy - 10, w: 20, h: 20, live: true });
        }
      }
    }
    function more() {
      var sp;
      if (s.end) return;
      if (n === 0) sp = { x0: -400, x1: 700, y: GY };
      else {
        var v = speedAt(p, gx), gap = 0, ty = Math.max(YMIN, Math.min(YMAX, gy + (r() * 2 - 1) * p.hv * 1.1));
        if (r() * 100 < p.lu) {
          ty = Math.max(ty, gy - J.top * 0.7);
          var reach = v * J.air(gy - ty) * SAFE;
          gap = Math.min(reach, 40 + r() * Math.max(0, reach - 40) * p.lw / 100);
          if (reach < 40) { gap = 0; ty = gy; }
        } else ty = Math.max(ty, gy - J.top * 0.5);
        var len = (300 + r() * 500) * Math.max(1, v / 220);
        sp = { x0: gx + gap, x1: gx + gap + len, y: ty };
        if (s.goal && sp.x1 >= s.goal) { sp.x1 = Math.max(sp.x0 + 900, s.goal + 900); s.end = true; put({ t: "g", x: Math.max(s.goal, sp.x0 + 200), y: sp.y - 90, w: 20, h: 90 }); }
      }
      n++; s.spans.push(sp); gx = sp.x1; gy = sp.y;
      if (!s.end) fill(sp);
    }
    function grow() {
      while (gx < s.me.x + AHEAD && !s.end) more();
      if (s.ticks % 30) return;
      while (s.spans.length > 2 && s.spans[0].x1 < s.me.x - 600) s.spans.shift();
      s.items = s.items.filter(function (it) { return it.x + (it.w || 0) > s.me.x - 600 || it.t === "g"; });
    }
    grow();
    function hit(a, b) { return a.x0 < b.x + b.w && a.x1 > b.x && a.y0 < b.y + b.h && a.y1 > b.y; }
    // presses: the first one starts the run; a press shortly before landing still jumps (buffer), shortly after leaving an edge too
    s.press = function () { if (s.state === "ready") { s.state = "run"; return ["start"]; } if (s.state === "run") { s.me.want = BUF; s.held = true; } return []; };
    s.release = function () { s.held = false; };
    s.setDuck = function (on) { s.duck = !!on; };
    s.speed = function () { return speedAt(p, s.me.x); };
    s.meters = function () { return Math.floor(Math.max(0, s.me.x) / 10); };
    s.points = function () { return s.meters() + s.coins * 5 + s.stomps * 10; };
    s.height = function () { return s.duck && s.me.on ? DH : PH; };
    s.step = function () {
      var ev = [], m = s.me, dt = STEP;
      if (s.state !== "run") return ev;
      s.ticks++;
      var px = m.x, py = m.y;
      m.x += speedAt(p, m.x) * dt;
      m.want -= dt; m.coy -= dt;
      if (m.want > 0 && (m.on || m.coy > 0)) { m.vy = -p.j; m.ht = HOLD; m.on = false; m.coy = 0; m.want = 0; ev.push("jump"); }
      vert(m, s.held, p.g);
      // the ground: land on a stretch from above, run into the side of a higher one, or fall off an edge
      var was = m.on, under = null;
      m.on = false;
      for (var i = 0; i < s.spans.length; i++) {
        var sp = s.spans[i];
        if (m.x + PW / 2 <= sp.x0 || m.x - PW / 2 >= sp.x1) continue;
        if (px + PW / 2 <= sp.x0 && m.y > sp.y + 4) { s.state = "over"; ev.push("dead"); return ev; }
        if (m.vy >= 0 && py <= sp.y + 0.5 && m.y >= sp.y && (!under || sp.y < under.y)) under = sp;
      }
      if (under) { m.y = under.y; m.vy = 0; m.on = true; if (!was) ev.push("land"); } else if (was) m.coy = COY;
      var hh = s.height(), me = { x0: m.x - PW / 2 + 3, x1: m.x + PW / 2 - 3, y0: m.y - hh + 3, y1: m.y };
      for (i = 0; i < s.items.length; i++) {
        var it = s.items[i];
        if (it.t === "f" && it.live) {
          if (it.k === "flug") { it.x += it.vx * dt; it.y = it.base - 64 + Math.sin(s.ticks * dt * 3.9 + it.ph) * 22; }
          else {
            it.x += it.vx * dt; if (it.x < it.x0 || it.x > it.x1 - it.w) it.vx = -it.vx;
            if (it.k === "huepf") { it.vy += 1400 * dt; it.y += it.vy * dt; if (it.y >= it.base - it.h) { it.y = it.base - it.h; it.vy = -460; } }
          }
        } else if (it.t === "x") {
          if (!it.go && m.x >= it.at) it.go = true;
          if (it.go && it.y < it.to) { it.vy += 1200 * dt; it.y = Math.min(it.to, it.y + it.vy * dt); }
        }
        if (it.live === false || !hit(me, it)) continue;
        if (it.t === "c") { it.live = false; s.coins++; ev.push("coin"); }
        else if (it.t === "g") { s.state = "goal"; ev.push("goal"); return ev; }
        else if (it.t === "f" && m.vy > 0 && py - 2 <= it.y + 6) { it.live = false; s.stomps++; m.vy = -p.j * 0.6; m.ht = 0; ev.push("stomp"); }
        else { s.state = "over"; ev.push("dead"); return ev; }
      }
      if (m.y > H + 80) { s.state = "over"; ev.push("dead"); return ev; }
      grow();
      return ev;
    };
    return s;
  }
  // The AI's slots (the server's schema, lib/duell-karte.mjs) or the editor's word rules -> a game. Numbers are never the
  // model's: a level picks them, each wanted thing switches its chance on.
  var LEVELS = { easy: { g: 1700, j: 680, v: 160, a: 5, vm: 280, hv: 20, lw: 55, k: 0.7, len: 400 }, normal: { g: 2000, j: 700, v: 200, a: 9, vm: 360, hv: 35, lw: 75, k: 1, len: 700 }, hard: { g: 2300, j: 740, v: 250, a: 14, vm: 460, hv: 60, lw: 90, k: 1.3, len: 1000 } };
  var HAS = { luecken: ["lu", 40], hindernisse: ["hi", 40], ducken: ["du", 25], muenzen: ["mu", 60], gegner: ["ge", 30], von_oben: ["fa", 35] };
  function build(o, seed) {
    o = o || {};
    var lv = LEVELS[o.level] || LEVELS.normal, has = Array.isArray(o.has) ? o.has : [], p = { g: lv.g, j: lv.j, v: lv.v, a: lv.a, vm: lv.vm, hv: lv.hv, lw: lv.lw, len: lv.len };
    Object.keys(HAS).forEach(function (k) { p[HAS[k][0]] = has.indexOf(k) >= 0 ? Math.round(HAS[k][1] * lv.k) : 0; });
    if (o.world === "bruecke") p.lu = Math.max(p.lu, Math.round(45 * lv.k));   // bridges have gaps between them
    if (Number.isInteger(o.len)) p.len = o.len;
    return L.sanitize({ m: o.mode, seed: seed >>> 0, w: o.world, e: o.figure, o: o.obstacle, c: o.coin, f: o.foe, fp: o.foes, p: p });
  }
  var api = { H: H, GY: GY, PW: PW, PH: PH, DH: DH, STEP: STEP, SAFE: SAFE, LEVELS: LEVELS, HAS: HAS, speedAt: speedAt, jumps: jumps, createSim: createSim, build: build };
  if (node) module.exports = api;
  else root.LaufEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
