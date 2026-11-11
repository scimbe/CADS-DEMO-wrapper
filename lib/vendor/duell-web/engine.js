/* Duell engine: deterministic flap simulation (no DOM). Same seed + same taps at the same ticks = same run. */
(function (root) {
  "use strict";
  var W = 288, H = 512, GROUND = 56, R = 15, BX = 86, PIPE_W = 52, INTERVAL = 170, TERM = 720, MARGIN = 46;
  var STEP = 1 / 120, PER_SECTION = 5;

  // rng: function() -> [0,1), params: sanitized {gravity,jump,gap,speed}. route (optional): the params of each section
  // of a route (core.js routeParams); pipe n belongs to section floor(n / PER_SECTION), the last one goes on for ever.
  // Each pipe keeps the gap it was made with; weight, jump and speed change once the bird passes into the next section.
  // k: tempo as time stretch (speed*k, gravity*k*k, jump*k): same path at every k
  function createSim(params, rng, route, k) {
    k = k || 1;
    function tk(p) { return { gravity: p.gravity * k * k, jump: p.jump * k, gap: p.gap, speed: p.speed * k }; }
    params = tk(params); route = route && route.map(tk);
    var sim = { W: W, H: H, GROUND: GROUND, R: R, BX: BX, PIPE_W: PIPE_W, STEP: STEP, params: route ? route[0] : params,
      bird: { y: H * 0.42, vy: 0, rot: 0 }, pipes: [], score: 0, state: "ready", ticks: 0, section: 0, sections: route ? route.length : 1 };
    var made = 0;
    function sectionOf(n) { return route ? Math.min(route.length - 1, Math.floor(n / PER_SECTION)) : 0; }

    function spawn(x) {
      var gap = route ? route[sectionOf(made)].gap : params.gap;
      var top = MARGIN + rng() * (H - GROUND - gap - MARGIN * 2);
      sim.pipes.push({ x: x, top: top, gap: gap, passed: false });
      made++;
    }
    function collide() {
      var b = sim.bird;
      if (b.y + R > H - GROUND) return true;
      if (b.y - R < 0) { b.y = R; b.vy = 0; }
      for (var i = 0; i < sim.pipes.length; i++) {
        var p = sim.pipes[i];
        if (BX + R > p.x && BX - R < p.x + PIPE_W && (b.y - R < p.top || b.y + R > p.top + p.gap)) return true;
      }
      return false;
    }
    // returns list of events: "flap", "start"; the tap waits for the next step (tick sim.ticks, spur.js)
    sim.flap = function () {
      if (sim.state === "over") return [];
      var ev = [];
      if (sim.state === "ready") { sim.state = "run"; ev.push("start"); }
      sim.tap = 1;
      ev.push("flap");
      return ev;
    };
    // advance by exactly STEP; returns events: "score", "dead"
    sim.step = function () {
      var ev = [];
      if (sim.state !== "run") return ev;
      var b = sim.bird, dt = STEP, params = sim.params;
      sim.ticks++;
      if (sim.tap) { sim.tap = 0; b.vy = -params.jump; }
      b.vy = Math.min(b.vy + params.gravity * dt, TERM * k);
      b.y += b.vy * dt;
      b.rot = Math.max(-0.5, Math.min(1.3, b.vy / k / 480));
      for (var i = 0; i < sim.pipes.length; i++) {
        var p = sim.pipes[i];
        p.x -= params.speed * dt;
        if (!p.passed && p.x + PIPE_W < BX) {
          p.passed = true; sim.score++; ev.push("score");
          if (route && sectionOf(sim.score) !== sim.section) { sim.section = sectionOf(sim.score); sim.params = route[sim.section]; ev.push("section"); }
        }
      }
      while (sim.pipes.length && sim.pipes[0].x < -PIPE_W) sim.pipes.shift();
      var last = sim.pipes.length ? sim.pipes[sim.pipes.length - 1].x : -Infinity;
      if (W - last >= INTERVAL) spawn(W + 20);
      if (collide()) { sim.state = "over"; ev.push("dead"); }
      return ev;
    };
    spawn(W + 40);
    return sim;
  }

  var api = { EV: 1, createSim: createSim, W: W, H: H, GROUND: GROUND, STEP: STEP, PIPE_W: PIPE_W, R: R, BX: BX, PER_SECTION: PER_SECTION };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DuellEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
