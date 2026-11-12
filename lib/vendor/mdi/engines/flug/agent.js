// Agenten-Duell im Flug (Modus "flappy" aus alt:src/duel.js und alt:src/modes.js): zwei Agenten fliegen dieselbe
// Strecke, eine Regel: flattern, wenn unter der Linie durch die naechste Luecke. Mut r verschiebt die Linie, Geduld p
// daempft das Zittern. Training: ein echter Flug misst, wo die Person flattert (learnFlap). Gleiche Agenten + gleicher
// Seed = gleiches Duell auf beiden Handys. Die anderen Duell-Modi (rps, mind, rap, auction, deck) gehoeren nicht zu E2.
import { createSim, flapState, stepState, PIPE_W, BX, R, H } from "./engine.js";
import { hash32, mulberry32 } from "./rng.js";
import { clampNum, sanitizeParams, sanitizeTheme, sanitizeSeed } from "./params.js";
import { sanitizeName, sanitizeEmoji } from "./text.js";

export const FLY_CAP = 40, MAX_TICKS = 120 * 90, SLIDERS = ["r", "p"];
export const EMOJI = ["🤖", "👾", "🦾", "🛸", "🧠", "🐙", "🦖", "🦝", "👻", "🍌", "🧃", "🔌"];
export const RIVALS = { de: ["Toastomat", "Kaktus 3000", "Sir Blinker", "Frau Lötkolben", "Der Föhn", "Socken-Bot"], en: ["Toastomatic", "Cactus 3000", "Sir Blinky", "Madam Solder", "The Hairdryer", "Sock Bot"] };

function slider(v, d) { return Math.round(clampNum(v, 0, 100, d)); }
export function sanitizeAgent(a, fallback) {
  a = a && typeof a === "object" ? a : {};
  const f = fallback || {};
  return { n: sanitizeName(a.n) || f.n || "", e: typeof a.e === "string" ? sanitizeEmoji(a.e) : (f.e || "🤖"), r: slider(a.r, f.r == null ? 50 : f.r), c: slider(a.c, f.c == null ? 50 : f.c), p: slider(a.p, f.p == null ? 50 : f.p) };
}
/** Duell-Dokument (alt Duel.sanitize fuer m "flappy"): a, b, seed, g {params, theme}, ch (Herausforderung). */
export function sanitizeDuel(o) {
  o = o && typeof o === "object" ? o : {};
  return { m: "flappy", a: sanitizeAgent(o.a), b: sanitizeAgent(o.b), seed: Math.floor(clampNum(o.seed, 0, 4294967295, 1)), ch: o.ch === 1 ? 1 : 0,
    g: { params: sanitizeParams(o.g && o.g.params), theme: sanitizeTheme(o.g && o.g.theme) } };
}
export function flyLine(ag) { return (ag.r - 50) * 0.9; }
export function flyStep(sim, ag, rnd) {
  if (sim.state === "ready") flapState(sim);
  let next = null;
  for (const p of sim.pipes) if (p.x + PIPE_W > BX - R) { next = p; break; }
  const mid = next ? next.top + sim.params.gap / 2 : H * 0.42, jitter = (rnd() - 0.5) * (100 - ag.p) * 0.45;
  if (sim.bird.y > mid + flyLine(ag) + jitter && sim.bird.vy >= 0) flapState(sim);
  return stepState(sim);
}
export function flySim(doc) { return createSim(doc.g.params, doc.seed); }
export function flyRnd(ag) { return mulberry32(hash32("fly|" + JSON.stringify(ag))); }
export function fly(doc, ag) {
  const sim = flySim(doc), rnd = flyRnd(ag);
  while (sim.state !== "over" && sim.score < FLY_CAP && sim.ticks < MAX_TICKS) flyStep(sim, ag, rnd);
  return sim.score;
}
/** Aus einem echten Trainingsflug: Abstand zur Lueckenmitte bei jedem Flattern -> Mut und Geduld. */
export function learnFlap(samples) {
  const s = (Array.isArray(samples) ? samples : []).filter((x) => typeof x === "number" && isFinite(x));
  if (s.length < 3) return null;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / s.length);
  return { r: slider(50 + mean / 0.9, 50), p: slider(100 - sd * 2, 50) };
}
/** "Gegner wuerfeln": der n-te Wurf dieses Blatts, nie aus dem Geraetezufall. */
export function rival(seed, n, names, faces) {
  const r = mulberry32(hash32("rival|" + seed + "|" + n)), f = (m) => Math.floor(r() * m);
  return { n: names[f(names.length)], e: faces[f(faces.length)], r: f(101), c: f(101), p: f(101) };
}
export function play(doc) { return { rounds: [], sa: fly(doc, doc.a), sb: fly(doc, doc.b) }; }
export function winner(res) { return res.sa === res.sb ? 0 : res.sa > res.sb ? 1 : -1; }
/** Warum es so ausging, aus Duell und Reglern gelesen (keine KI); Tipp nur fuer den Verlierer. */
export function explain(doc, res) {
  const w = winner(res), W = w > 0 ? "a" : w < 0 ? "b" : "", Lo = W === "a" ? "b" : W === "b" ? "a" : "";
  const out = (k, v, tip) => ({ k, w: W, v: Object.assign({ a: res.sa, b: res.sb }, v || {}), tip: W ? tip || null : null });
  if (!W) return out("draw");
  const ls = doc[Lo], ws = doc[W], n = (Lo === "a" ? res.sa : res.sb) + 1;
  if (ls.p + 10 <= ws.p) return out("flyShaky", { p: ls.p, n }, "tipShaky");
  if (Math.abs(ls.r - 50) >= Math.abs(ws.r - 50) + 10) return out("flyClose", { r: ls.r, n }, "tipClose");
  return out("flyLuck", { n, m: (W === "a" ? res.sa : res.sb) + 1 });
}
/** Katalog-Duell (alt Duel.fromIdea, m "flappy"). */
export function fromIdea(id, x, profile, lang, rivalName) {
  return sanitizeDuel({ m: "flappy", seed: hash32("duel-" + id), a: Object.assign({ n: profile.nick, e: profile.emoji }, x.a), b: Object.assign({ n: rivalName, e: x.e || "🤖" }, x.b), g: x.game });
}
export { sanitizeSeed };
