// Karte "lauf": Engine E3 (Runner und Plattformer, src/engines/lauf/), die zweite Spiel-Engine der freien Karte (Genre G2).
// Echtzeit-Vertrag ADR 0001 (b). Eingabe je Sitz {b}: Bit 0 Tippen (Puls), Bit 1 Halten, Bit 2 Ducken = Spur-Wort des Altcodes.
// Allein; mit 2 Sitzen ist Sitz 1 der Geist aus dem Link. Herausforderung ohne Geist: l.r = Punkte zum Schlagen (alt).
import manifest from "./manifest.json" with { type: "json" };
import { initState, stepState, copyState, press, release, setDuck, points, meters, bot as pageBot, withApi, STEP } from "../../engines/lauf/engine.js";
import { laufOf, fromServerDoc, toServerDoc, txt } from "../../engines/lauf/params.js";
import { fromWords } from "../../engines/lauf/words.js";
import { runOps, poseOf, VIEW } from "../../engines/lauf/view.js";
import { mixF64, FNV0, hex32 } from "../../engines/flug/rng.js";
import { fmt } from "../../engines/flug/text.js";
import TX from "../../engines/lauf/texts.json" with { type: "json" };

const TPS = 120, TMAX = 180 * TPS;
// Sitze aus players: Rollen-Array des Hosts (["human","none"], ["ghost","human"] …) oder Anzahl; "none" = kein Flieger
function seatsOf(players) {
  if (Array.isArray(players)) return players.map((r) => r !== "none");
  const n = Math.max(1, Math.min(2, players || 1)), out = []; for (let i = 0; i < n; i++) out.push(true); return out;
}
const active = (sims) => sims.filter(Boolean);
// Reihenfolge fuer das Bild: der eigene Sitz zuerst, die anderen als Geist
function order(sims, seat) { const me = sims[seat] || active(sims)[0]; return [me].concat(sims.filter((s) => s && s !== me)); }
// Kopfzeile nach Gate C: "DU 7 : COMPUTER 5" bzw. "DU 7 : AUFNAHME 5" (im Code heisst die Aufnahme ghost)
const WHO = { de: { you: "DU", bot: "COMPUTER", ghost: "AUFNAHME", remote: "FREUND" }, en: { you: "YOU", bot: "COMPUTER", ghost: "RECORDING", remote: "FRIEND" } };
function rival(st, seat) { const r = st.roles || []; for (let i = 0; i < r.length; i++) if (i !== seat && r[i] !== "none" && r[i] !== "human") return r[i]; return r.length > 1 && r[1 - seat] === "human" ? "remote" : null; }
// Eigenes Foto (media.local): Parameterwert "local:<id>", id = 32 Hex (SHA-256) im Geraetespeicher; anderes = kein Foto
const PHOTO = /^local:([0-9a-f]{32})$/;
function mediaOf(params) { const id = (v) => { const m = typeof v === "string" && PHOTO.exec(v); return m ? m[1] : null; }; return { figur: id(params.figur), hintergrund: id(params.hintergrund) }; }
function say(key, o) { return { de: fmt(TX.de[key], o), en: fmt(TX.en[key], o) }; }

function init({ params: input, players }) {
  const params = input || {}, l = laufOf(params), sims = seatsOf(players).map((on) => (on ? initState(l, params.tempo) : null));
  return { t: 0, sims, fx: { flash: 0, shake: 0, since: {} }, r: l.r || 0, title: txt(params.t, 40), roles: Array.isArray(players) ? players.slice() : null, media: mediaOf(params) };
}
function copy(st) { return { ...st, fx: { ...st.fx, since: { ...st.fx.since } }, sims: st.sims.map((s) => (s ? copyState(s) : null)) }; }
const DONE = ["ready", "run", "over", "goal"];
const done = (s) => s.state === "over" || s.state === "goal";

function step(state, inputs) {
  const st = copy(state), ev = [];
  st.fx.flash = Math.max(0, st.fx.flash - 2.5 / TPS); st.fx.shake = Math.max(0, st.fx.shake - 40 / TPS);
  st.sims.forEach((s, i) => {
    if (!s || done(s) || st.t >= TMAX) return;
    const b = (inputs && inputs[i] && inputs[i].b) | 0;
    // Der Lauf beginnt bei Tick 0 (alt: der erste Tipp startet); danach wirken Eingaben am naechsten Tick
    if (st.t === 0 && s.state === "ready") { press(s); ev.push({ k: "start", seat: i }); }
    else if (b & 1) press(s);
    if (!(b & 2)) release(s);
    setDuck(s, (b & 4) !== 0);
    for (const k of stepState(s)) ev.push({ k, seat: i });
  });
  const first = st.sims.findIndex(Boolean);
  for (const e of ev) {
    if (e.seat !== first) continue;
    if (e.k === "jump") st.fx.since.sprung = st.t;
    if (e.k === "coin" || e.k === "stomp") st.fx.since.treffer = st.t;
    if (e.k === "goal") st.fx.since.sieg = st.t;
    if (e.k === "dead") { st.fx.shake = 10; st.fx.flash = 1; }
  }
  st.t++;
  return { state: st, ev };
}

function status(st) {
  const sc = st.sims.map((s) => (s ? points(s) : 0)), over = active(st.sims).every(done) || st.t >= TMAX, me = active(st.sims)[0];
  const out = { over, score: sc, winner: null, solo: active(st.sims).length === 1 && !st.r, meters: me ? meters(me) : 0, goal: me.state === "goal" };
  if (over && active(st.sims).length === 2) out.winner = sc[0] > sc[1] ? 0 : sc[1] > sc[0] ? 1 : -1;
  else if (over && st.r) out.winner = sc[0] > st.r ? 0 : -1;
  out.say = over ? say(me.state === "goal" ? "lf_goal2" : "lf_over2", { m: meters(me), c: me.coins }) : null;
  if (over && st.r) out.beat = say(sc[0] > st.r ? "lf_won" : "lf_short", { n: st.r, d: st.r - sc[0] + 1 });
  return out;
}

function view(st, ctx) {
  const c = ctx || {}, lang = c.lang === "en" ? "en" : "de", sims = c.preview ? order(st.sims, c.seat || 0).slice(0, 1) : order(st.sims, c.seat || 0), me = sims[0], t = c.t != null ? c.t : st.t / TPS;
  const since = {}; for (const k of Object.keys(st.fx.since)) since[k] = (st.t - st.fx.since[k]) / TPS;
  const layers = runOps(sims, { t, reduced: !!c.reduced, media: st.media, flash: st.fx.flash, shake: st.fx.shake, pose: poseOf(me.l, t, since, !!c.reduced) });
  // Gate C, Reihe Dach-Lauf: zwei Werte ohne Doppelpunkt (METER · MUENZEN); der Gegner klein darunter
  const hud = fmt(TX[lang].lf_hud2, { m: meters(me), c: me.coins }), rv = sims[1] ? rival(st, c.seat || 0) || "ghost" : null;
  layers.push({ id: "hud", ops: [{ o: "text", x: VIEW / 2, y: 30, text: hud, size: 26, font: "brand", align: "center", base: "middle", fill: "#ffffff", stroke: "#00000073", lw: 4 }]
    .concat(rv ? [{ o: "text", x: VIEW / 2, y: 58, text: WHO[lang][rv] + " " + fmt(TX[lang].lf_hud2, { m: meters(sims[1]), c: sims[1].coins }), size: 16, font: "body", align: "center", base: "middle", fill: "#ffffff", stroke: "#00000073", lw: 3 }] : [])
    .concat(st.r && !rv ? [{ o: "text", x: VIEW / 2, y: 58, text: fmt(TX[lang].lf_beat, { n: st.r }), size: 16, font: "body", align: "center", base: "middle", fill: "#ffffff", stroke: "#00000073", lw: 3 }] : []) });
  return { t: "canvas", w: VIEW, h: 360, layers, a11y: fmt(TX[lang].lf_area, { t: st.title || TX[lang].lf_def }) + ". " + hud };
}

// Bot (Standbild, Vorschau): der einfache Spieler der Seite (alt lauf-ui.js bot) als Eingabewort
function bot(st, seat) {
  const s = st.sims[seat]; if (!s || done(s)) return { b: 0 };
  // die Wirkung des Seiten-Bots auf die Eingabewarteschlange wird zum Eingabewort: Druecken = Tippen + Halten, Loslassen = 0
  const probe = withApi(copyState(s));
  probe.inq.jump = false;
  pageBot(probe);
  return { b: (probe.inq.jump ? 1 : 0) | (probe.inq.held ? 2 : 0) };
}
function hash(st) {
  let h = FNV0, h2 = 0x01000193;
  for (const s of active(st.sims)) {
    h2 = mixF64(mixF64(mixF64(h2, s.me.x), s.me.y), s.ticks);
    h = mixF64(mixF64(mixF64(h, s.me.x), s.me.y), s.me.vy); h = mixF64(mixF64(h, s.coins), s.stomps); h = mixF64(h, s.ticks);
    h = mixF64(mixF64(mixF64(h, s.r), DONE.indexOf(s.state)), s.gen.x);
    let live = 0, n = 0;
    for (const it of s.items) { if (it.t === "f" && it.live) h = mixF64(mixF64(h, it.x), it.y); if (it.live !== undefined) { live = (live * 2 + (it.live ? 1 : 0)) % 4294967296; n++; } }
    h = mixF64(mixF64(h, live), n);
  }
  h = mixF64(h, st.t); h2 = mixF64(mixF64(h2, st.t), h);
  return hex32(h) + hex32(h2);
}

export default {
  manifest, init, step, status, view, bot, hash,
  fromFree: fromServerDoc, toFree: (params) => toServerDoc(params, null),
  fromWords, STEP
};
