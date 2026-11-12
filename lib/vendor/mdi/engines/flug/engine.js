// Engine E2 Flug: deterministische Flatter-Simulation ohne DOM, bitgenau aus alt:src/engine.js (EV 1).
// Gleicher Seed + gleiche Taps an denselben Ticks = gleicher Lauf. Im Lauf nur + - * / Math.min/max (IEEE-754 exakt,
// 08-forschung/determinismus.md Befund 1; ADR 0001 rt.numeric "f64"), kein Math.sin/pow/random: die alten
// Golden-Hashes (float64-Bits) halten. Der Zustand ist ein reines Datenobjekt (auch der Zufall: r = mulberry32-Zaehler),
// damit die Karte ihn kopieren, hashen und als Geist nachspielen kann.
import { draw } from "./rng.js";

export const EV = 1;
export const W = 288, H = 512, GROUND = 56, R = 15, BX = 86, PIPE_W = 52, INTERVAL = 170, TERM = 720, MARGIN = 46;
export const STEP = 1 / 120, TPS = 120, PER_SECTION = 5;

function tk(p, k) { return { gravity: p.gravity * k * k, jump: p.jump * k, gap: p.gap, speed: p.speed * k }; }
function sectionOf(s, n) { return s.route ? Math.min(s.route.length - 1, Math.floor(n / PER_SECTION)) : 0; }
function spawn(s, x) {
  const gap = s.route ? s.route[sectionOf(s, s.made)].gap : s.base.gap;
  const top = MARGIN + draw(s) * (H - GROUND - gap - MARGIN * 2);
  s.pipes.push({ x, top, gap, passed: false });
  s.made++;
}
function collide(s) {
  const b = s.bird;
  if (b.y + R > H - GROUND) return true;
  if (b.y - R < 0) { b.y = R; b.vy = 0; }
  for (const p of s.pipes) if (BX + R > p.x && BX - R < p.x + PIPE_W && (b.y - R < p.top || b.y + R > p.top + p.gap)) return true;
  return false;
}

/**
 * Neuer Zustand. params: {gravity,jump,gap,speed} (sanitizeParams), seed: uint32, route: Physik je Abschnitt
 * (routeParams) oder null; Roehre n gehoert zu Abschnitt floor(n / PER_SECTION). k: Tempo als Zeitdehnung
 * (speed*k, gravity*k*k, jump*k): dieselbe Bahn bei jedem k.
 */
export function initState(params, seed, route, k) {
  k = k || 1;
  const base = tk(params, k), rt = route ? route.map((p) => tk(p, k)) : null;
  const s = { k, base, route: rt, params: rt ? rt[0] : base, bird: { y: H * 0.42, vy: 0, rot: 0 }, pipes: [], score: 0, state: "ready",
    ticks: 0, section: 0, sections: rt ? rt.length : 1, tap: 0, made: 0, r: seed >>> 0 };
  spawn(s, W + 40);
  return s;
}
/** Tap: "start" beim ersten, dann "flap"; der Tap wirkt im naechsten Schritt (Tick s.ticks, Spur). */
export function flapState(s) {
  if (s.state === "over") return [];
  const ev = [];
  if (s.state === "ready") { s.state = "run"; ev.push("start"); }
  s.tap = 1;
  ev.push("flap");
  return ev;
}
/** Genau ein STEP weiter (veraendert s); Ereignisse "score", "section", "dead". */
export function stepState(s) {
  const ev = [];
  if (s.state !== "run") return ev;
  const b = s.bird, dt = STEP, pr = s.params, k = s.k;
  s.ticks++;
  if (s.tap) { s.tap = 0; b.vy = -pr.jump; }
  b.vy = Math.min(b.vy + pr.gravity * dt, TERM * k);
  b.y += b.vy * dt;
  b.rot = Math.max(-0.5, Math.min(1.3, b.vy / k / 480));
  for (const p of s.pipes) {
    p.x -= pr.speed * dt;
    if (!p.passed && p.x + PIPE_W < BX) {
      p.passed = true; s.score++; ev.push("score");
      if (s.route && sectionOf(s, s.score) !== s.section) { s.section = sectionOf(s, s.score); s.params = s.route[s.section]; ev.push("section"); }
    }
  }
  while (s.pipes.length && s.pipes[0].x < -PIPE_W) s.pipes.shift();
  const last = s.pipes.length ? s.pipes[s.pipes.length - 1].x : -Infinity;
  if (W - last >= INTERVAL) spawn(s, W + 20);
  if (collide(s)) { s.state = "over"; ev.push("dead"); }
  return ev;
}
/** Tiefe Kopie (nur Daten; float64 bleibt exakt). params zeigt wieder auf den Abschnitt bzw. die Grundphysik. */
export function copyState(s) {
  const c = { ...s, base: { ...s.base }, route: s.route ? s.route.map((p) => ({ ...p })) : null, bird: { ...s.bird }, pipes: s.pipes.map((p) => ({ ...p })) };
  c.params = c.route ? c.route[c.section] : c.base;
  return c;
}

/** Objekt-API wie alt createSim (sim.flap, sim.step, Felder direkt), fuer Bots, Spur und Tests. */
export function createSim(params, seed, route, k) {
  const s = initState(params, seed, route, k);
  Object.assign(s, { W, H, GROUND, R, BX, PIPE_W, STEP });
  Object.defineProperty(s, "flap", { value: () => flapState(s), enumerable: false });
  Object.defineProperty(s, "step", { value: () => stepState(s), enumerable: false });
  return s;
}

/** Die naechste Roehre vor dem Vogel (fuer Bots und die Anzeige). */
export function nextPipe(s, strict) {
  for (const p of s.pipes) if (strict ? p.x + PIPE_W > BX - R : p.x + PIPE_W >= BX - R) return p;
  return null;
}
/** Demo-Bot aus alt:src/game.js bot(): tippt, wenn der Vogel unter die Linie frac der Luecke faellt. */
export function demoWants(s, frac = 0.62) {
  const nx = nextPipe(s, false), mid = nx ? nx.top + nx.gap * frac : H * 0.45;
  return s.bird.y > mid && s.bird.vy > 0;
}
