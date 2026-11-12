// Karte "flug": Bau dein Lava-Level (spiel-lava) und ihre 15 Varianten auf der Engine E2 (src/engines/flug/).
// Echtzeit-Vertrag ADR 0001 (b): init/step/status/view/bot/hash, Eingabe je Sitz {b}: Bit 0 Tap (Spur-Wort des Altcodes).
// Modi: solo (allein; mit 2 Sitzen ist Sitz 1 der Geist aus dem Link), agent (Agenten-Duell flug-agent/flug-mond: beide
// Agenten fliegen dieselbe Strecke), train (ein echter Flug, aus dem der eigene Agent Mut und Geduld lernt).
import manifest from "./manifest.json" with { type: "json" };
import { initState, flapState, stepState, copyState, demoWants, nextPipe, W, H, TPS } from "../../engines/flug/engine.js";
import { gameOf, routeParams, fromServerDoc, toServerDoc } from "../../engines/flug/params.js";
import { flyStep, flyLine, learnFlap, sanitizeAgent, explain, winner, FLY_CAP, MAX_TICKS } from "../../engines/flug/agent.js";
import { hash32, draw, mixF64, FNV0, hex32 } from "../../engines/flug/rng.js";
import { flightOps, duelOps } from "../../engines/flug/view.js";
import { VARIANTS, variantParams } from "../../engines/flug/variants.js";
import TX from "../../engines/flug/texts.json" with { type: "json" };
import { fmt } from "../../engines/flug/text.js";

const TMAX = 90 * TPS;
const FX0 = () => ({ flash: 0, shake: 0, since: {} });
// Sitze aus players: Rollen-Array des Hosts (["human","none"], ["ghost","human"] …) oder Anzahl; "none" = kein Flieger
function seatsOf(players) {
  if (Array.isArray(players)) return players.map((r) => r !== "none");
  const n = Math.max(1, Math.min(2, players || 1)), out = []; for (let i = 0; i < n; i++) out.push(true); return out;
}
const active = (sims) => sims.filter(Boolean);
// Reihenfolge fuer das Bild: der eigene Sitz zuerst, die anderen als Geist
function order(sims, seat) { const me = sims[seat] || active(sims)[0]; return [me].concat(sims.filter((s) => s && s !== me)); }
function say(key, o) { return { de: fmt(TX.de[key], o), en: fmt(TX.en[key], o) }; }

function init({ params: input, players }) {
  const params = input || {}, g = gameOf(params), mode = params.mode === "agent" || params.mode === "train" ? params.mode : "solo";
  const st = { mode, g, t: 0, fx: FX0(), samples: [] };
  if (mode === "agent") {
    // alt duel.js flySim: Strecke aus seed und Grundphysik (ohne Route, ohne Tempo), je Agent ein eigener Zufallsstrom
    const a = sanitizeAgent(params.agent), b = sanitizeAgent(params.rival);
    st.agents = [a, b];
    st.sims = [initState(g.params, g.seed, null, 1), initState(g.params, g.seed, null, 1)];
    st.rr = [{ r: hash32("fly|" + JSON.stringify(a)) }, { r: hash32("fly|" + JSON.stringify(b)) }];
  } else {
    const seats = mode === "train" ? [true] : seatsOf(players);
    st.sims = seats.map((on) => (on ? Object.assign(initState(g.params, g.seed, routeParams(g), g.k), { trail: [] }) : null));
  }
  return st;
}
function copy(st) {
  return { ...st, fx: { ...st.fx, since: { ...st.fx.since } }, samples: st.samples.slice(), rr: st.rr ? st.rr.map((x) => ({ ...x })) : undefined,
    sims: st.sims.map((s) => (s ? Object.assign(copyState(s), s.trail ? { trail: s.trail.slice() } : {}) : null)) };
}
function agentDone(s) { return s.state === "over" || s.score >= FLY_CAP || s.ticks >= MAX_TICKS; }

function step(state, inputs) {
  const st = copy(state), ev = [];
  st.fx.flash = Math.max(0, st.fx.flash - 2.5 / TPS); st.fx.shake = Math.max(0, st.fx.shake - 60 / TPS);
  if (st.mode === "agent") {
    st.sims.forEach((s, i) => { if (!agentDone(s)) for (const k of flyStep(s, st.agents[i], () => draw(st.rr[i]))) ev.push({ k, seat: i }); });
  } else {
    st.sims.forEach((s, i) => {
      if (!s || s.state === "over" || st.t >= TMAX) return;
      const b = (inputs && inputs[i] && inputs[i].b) | 0;
      // Der Lauf beginnt mit einem Tipp bei Tick 0 (alt: der erste Tipp startet, die Spur beginnt mit Tap 0)
      if (st.t === 0 && s.state === "ready") { flapState(s); ev.push({ k: "start", seat: i }); }
      if (b & 1) {
        if (st.mode === "train" && s.state === "run") { const nx = nextPipe(s, true); if (nx) st.samples.push(s.bird.y - (nx.top + s.params.gap / 2)); }
        flapState(s); ev.push({ k: "flap", seat: i });
      }
      for (const k of stepState(s)) ev.push({ k, seat: i });
      if (s.ticks % 3 === 0 && s.state === "run") { s.trail.push(s.bird.y); if (s.trail.length > 8) s.trail.shift(); }
    });
  }
  const first = st.sims.findIndex(Boolean);
  for (const e of ev) {
    if (e.seat !== first) continue;
    if (e.k === "score") st.fx.since.treffer = st.t;
    if (e.k === "flap") st.fx.since.sprung = st.t;
    if (e.k === "dead") { st.fx.flash = 1; st.fx.shake = 18; }
  }
  st.t++;
  return { state: st, ev };
}

function status(st) {
  const sc = st.sims.map((s) => (s ? s.score : 0));
  if (st.mode === "agent") {
    const over = st.sims.every(agentDone), res = { rounds: [], sa: sc[0], sb: sc[1] }, w = winner(res);
    const out = { over, score: sc, winner: over ? (w > 0 ? 0 : w < 0 ? 1 : -1) : null };
    if (over) {
      const who = (a, fb) => a.n || fb;
      out.say = w === 0 ? say("duelDraw") : w > 0 && !st.agents[0].n ? say("duelWinYou") : say("duelWin", { n: who(w > 0 ? st.agents[0] : st.agents[1], "Agent") });
      out.why = explain({ a: st.agents[0], b: st.agents[1] }, res);
    }
    return out;
  }
  const over = active(st.sims).every((s) => s.state === "over") || st.t >= TMAX;
  // solo: nur ein Flieger, kein Gewinner (Ergebniszeile = say)
  const out = { over, score: sc, winner: null, solo: active(st.sims).length === 1 };
  if (over && active(st.sims).length === 2) out.winner = sc[0] > sc[1] ? 0 : sc[1] > sc[0] ? 1 : -1;
  if (st.mode === "train" && over) out.learned = learnFlap(st.samples);
  out.say = over ? say("bestN", { n: Math.max(...sc) }) : null;
  return out;
}

function view(st, ctx) {
  const c = ctx || {}, lang = c.lang === "en" ? "en" : "de";
  if (st.mode === "agent") {
    const [a, b] = st.agents;
    return { t: "canvas", w: W, h: H, layers: duelOps(c.col || ["#ffd400", "#ff3b1d"], a, b, st.sims[0], st.sims[1]),
      a11y: (a.n || TX[lang].you) + " " + st.sims[0].score + " : " + st.sims[1].score + " " + (b.n || "Agent") };
  }
  const fx = { ...st.fx, since: {} };
  for (const k of Object.keys(st.fx.since)) fx.since[k] = (st.t - st.fx.since[k]) / TPS;
  const sims = c.preview ? order(st.sims, c.seat || 0).slice(0, 1) : order(st.sims, c.seat || 0);
  const layers = flightOps(st.g, sims, { t: c.t != null ? c.t : st.t / TPS, reduced: !!c.reduced, assets: c.assets }, fx);
  const me = sims[0], hud = [{ o: "text", x: W / 2, y: 64, text: String(me.score), size: 44, font: "brand", align: "center", base: "middle", fill: "#ffffff", stroke: "#00000080", lw: 4 }];
  if (sims[1]) hud.push({ o: "text", x: W / 2, y: 100, text: "👻 " + sims[1].score, size: 18, font: "body", align: "center", base: "middle", fill: "#ffffff", stroke: "#00000080", lw: 3 });
  layers.push({ id: "hud", ops: hud });
  return { t: "canvas", w: W, h: H, layers, a11y: fmt(lang === "en" ? "Flight game: {t}, {n} points" : "Flugspiel: {t}, {n} Punkte", { t: st.g.title, n: me.score }) };
}

// Bot (Vorschau im Editor, Bild der Karte): der Demo-Bot des Altcodes (game.js bot)
function bot(st, seat, opt) {
  const s = st.sims[seat]; if (!s || st.mode === "agent") return { b: 0 };
  const frac = [0.7, 0.62, 0.55][Math.max(0, Math.min(2, ((opt && opt.level) || 2) - 1))];
  return { b: demoWants(s, frac) ? 1 : 0 };
}
// Zustandshash ueber die exakten float64-Bits (rt.numeric "f64")
function hash(st) {
  let h = FNV0, h2 = 0x01000193;
  for (const s of active(st.sims)) {
    h2 = mixF64(mixF64(mixF64(h2, s.bird.y), s.score), s.ticks);
    h = mixF64(mixF64(h, s.bird.y), s.bird.vy); h = mixF64(h, s.score); h = mixF64(h, s.ticks);
    h = mixF64(mixF64(mixF64(mixF64(h, s.r), s.made), s.tap), s.section); h = mixF64(h, ["ready", "run", "over"].indexOf(s.state));
    for (const p of s.pipes) h = mixF64(mixF64(h, p.x), p.top);
  }
  if (st.rr) for (const x of st.rr) h = mixF64(h, x.r);
  h = mixF64(h, st.t); h2 = mixF64(mixF64(h2, st.t), h);
  return hex32(h) + hex32(h2);
}

export default {
  manifest, init, step, status, view, bot, hash,
  // freie Karte (Strang K): Server-Dokument G1 <-> Kartenparameter
  fromFree: fromServerDoc, toFree: (params) => toServerDoc(params, null),
  variantParams, variants: VARIANTS, flyLine
};
