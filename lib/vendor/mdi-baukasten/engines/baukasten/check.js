// Pruefstufe 1 des Baukastens (Strang B): Form (spec.normalize) + Sinn + Grenzen. Rein, dieselbe Datei auf Geraet und Server
// (lib/vendor/mdi-baukasten im Wrapper, Hash gepinnt). Jede Ablehnung nennt einen Grund in Worten, damit die Reparaturrunde
// des Servers dem Modell sagen kann, was falsch war (ScriptDoctor-Muster: Rueckmeldung aus dem Pruefer, nicht Selbstkritik).
import { normalize, emojiOk } from "./spec.js";

/** Grenzen fuer das Rechenbudget: der Interpreter haelt sie zur Laufzeit zusaetzlich ein (nie Absturz, nie Endlosschleife). */
export const LIMITS = Object.freeze({ startEntities: 150, alive: 200, trail: 60, cells: 24, descBytes: 6000, maxTicks: 60 * 300, pairs: 6000 });

// Relative Leuchtdichte (WCAG 2.2) der festen Farben in Millionstel, einmal aus den Hex-Werten berechnet (Token hell aus
// ui/tokens.css: yellow #ffd400, red #ff3b1d, ink #111111, paper #fffaf0, muted #8a8a8a; sonst spec.HEX). Als Tabelle,
// weil die Engine-Dateien keine approximierte Mathematik enthalten duerfen (scripts/harness.js).
export const LUM = Object.freeze({ yellow: 683470, red: 244766, ink: 5605, paper: 959225, muted: 254152, blue: 127657, green: 426722, pink: 294963, orange: 316670, sky: 649669, lime: 837994, violet: 123375, white: 1000000 });
/** WCAG-Kontrastverhaeltnis zweier Farbnamen (nur Pruefung, nie Spielzustand). */
export function contrast(a, b) { const x = (LUM[a] ?? 250000) / 1e6, y = (LUM[b] ?? 250000) / 1e6; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

const isGrid = (d) => d.world.cols > 0 && d.world.rows > 0;
const SIDE = ["top", "bottom", "left", "right", "any"];

/** Alle Texte, die das Spiel zeigt (fuer die Inhaltspruefung S1/S4 des Servers). */
export function textsOf(d) {
  const t = [d.title, d.goal];
  for (const th of d.things) { if (th.text) t.push(th.text); if (th.emoji) t.push(th.emoji); }
  for (const p of d.turn.pairs) t.push(p);
  for (const it of d.turn.items) t.push(it.q, it.a, ...it.wrong);
  return t.filter((s) => typeof s === "string" && s);
}

/**
 * Rohdaten -> { ok, desc, errors[], notes[] }. opt.clamp/opt.llm wie spec.normalize. errors leer = bestanden.
 */
export function check(raw, opt = {}) {
  let size = 0;
  try { size = JSON.stringify(raw).length; } catch (e) { return { ok: false, desc: null, errors: ["nicht serialisierbar"], notes: [] }; }
  if (size > LIMITS.descBytes * (opt.llm ? 2 : 1)) return { ok: false, desc: null, errors: ["Beschreibung zu gross (" + size + " Byte)"], notes: [] };
  const { desc: d, errors, notes } = normalize(raw, opt);
  if (errors.length) return { ok: false, desc: d, errors, notes };
  const E = (m) => errors.push(m);
  const ids = new Map();
  d.things.forEach((t, i) => { if (ids.has(t.id)) E("Ding " + t.id + " doppelt"); ids.set(t.id, i); });
  const has = (x) => ids.has(x), thing = (x) => d.things[ids.get(x)];
  const grid = isGrid(d);
  const owned = (x) => d.start.some((p) => p.thing === x && p.seat >= 0);

  if (d.mode === "realtime") {
    if (!d.things.length) E("keine Dinge");
    if ((d.world.cols > 0) !== (d.world.rows > 0)) E("Raster braucht cols und rows");
    for (const t of d.things) {
      if (t.look === "emoji" && !emojiOk(t.emoji)) E(t.id + ": look emoji ohne gueltiges Emoji");
      if (t.look === "text" && !t.text) E(t.id + ": look text ohne Text");
      if (t.look !== "emoji" && contrast(t.color, d.bg) < 3) E(t.id + ": Farbe " + t.color + " auf " + d.bg + " zu schwach (Kontrast " + (Math.round(contrast(t.color, d.bg) * 10) / 10) + " < 3)");
      if (grid && ["flap", "jump", "lr", "ud", "move", "drag"].includes(t.control)) E(t.id + ": Steuerung " + t.control + " passt nicht zum Raster (steer oder tap)");
      if (!grid && t.control === "steer") E(t.id + ": steer nur im Raster (world.cols/rows)");
      if (!grid && t.trail > 0) E(t.id + ": trail nur im Raster");
      if (["flap", "jump", "lr", "ud", "move", "steer"].includes(t.control) && t.power <= 0) E(t.id + ": Steuerung " + t.control + " braucht power > 0");
      // springen geht nur vom Boden: unterer Rand als Wand oder ein festes Ding (Gold-Korpus g09/g19: Figur fiel sofort heraus)
      if (t.control === "jump" && !(d.world.bottom === "wall" || d.things.some((o) => o.solid))) E(t.id + ": jump braucht Boden (world.bottom = wall oder ein Ding mit solid true)");
      if (t.control === "jump" && (!t.gravity || d.world.gravity <= 0)) E(t.id + ": jump braucht gravity true und world.gravity > 0");
      if (t.ai !== "none" && t.power <= 0 && t.vx === 0 && t.vy === 0) E(t.id + ": ai " + t.ai + " braucht power > 0 (Tempo)");
    }
    let n = 0;
    for (const p of d.start) {
      if (!has(p.thing)) { E("start: Ding " + p.thing + " fehlt"); continue; }
      if (p.seat >= d.players) E("start " + p.thing + ": Sitz " + p.seat + " bei " + d.players + " Spieler(n)");
      n += p.n;
      if (grid) {
        const last = p.n - 1, cx = p.x + (last % p.cols) * p.dx, cy = p.y + Math.floor(last / p.cols) * p.dy;
        if (p.x < 0 || p.y < 0 || p.x >= d.world.cols || p.y >= d.world.rows || cx < 0 || cy < 0 || cx >= d.world.cols || cy >= d.world.rows) E("start " + p.thing + ": Zelle ausserhalb des Rasters");
      }
    }
    if (n > LIMITS.startEntities) E("zu viele Dinge am Start (" + n + " > " + LIMITS.startEntities + ")");
    for (const s of d.spawn) {
      if (!has(s.thing)) { E("spawn: Ding " + s.thing + " fehlt"); continue; }
      if (grid) continue;
      // ausserhalb einer Wand Erzeugtes wird an die Wand geschoben und bleibt stehen: offener Rand noetig
      if (s.x + s.xr > d.world.w && d.world.right === "wall") E("spawn " + s.thing + ": rechts ausserhalb der Wand (world.right = open)");
      if (s.x - s.xr < 0 && d.world.left === "wall") E("spawn " + s.thing + ": links ausserhalb der Wand (world.left = open)");
      if (s.y + s.yr > d.world.h && d.world.bottom === "wall") E("spawn " + s.thing + ": unten ausserhalb der Wand (world.bottom = open)");
      if (s.y - s.yr < 0 && d.world.top === "wall" && s.gap === 0) E("spawn " + s.thing + ": oben ausserhalb der Wand (world.top = open)");
    }
    let decides = d.end.time > 0 || d.end.score > 0 || d.end.lives > 0;
    d.rules.forEach((r, i) => {
      const at = "Regel " + (i + 1) + " (" + r.when + ")";
      if (["touch", "out", "tap", "clear", "pass"].includes(r.when) && !has(r.a)) E(at + ": a " + (r.a || "leer") + " ist kein Ding");
      if ((r.when === "touch" || r.when === "pass") && !has(r.b)) E(at + ": b " + (r.b || "leer") + " ist kein Ding");
      if (r.when === "out" && !SIDE.includes(r.b)) E(at + ": b muss ein Rand sein (top, bottom, left, right, any)");
      if (r.when === "out" && r.b !== "any" && d.world[r.b] !== "open") E(at + ": Rand " + r.b + " ist nicht offen (world." + r.b + " = open)");
      if (r.when === "every" && r.n < 100) E(at + ": n (ms) mindestens 100");
      if (r.when === "tap" && has(r.a) && thing(r.a).control !== "tap") E(at + ": " + r.a + " ist nicht antippbar (control tap)");
      for (const e of r.do) {
        if (e.act === "spawn" && !has(e.thing)) E(at + ": spawn braucht ein Ding (thing)");
        if (e.act === "bounce" && r.when !== "touch") E(at + ": bounce nur bei touch");
        if ((e.on === "b") && !["touch", "pass"].includes(r.when)) E(at + ": on b nur bei touch/pass");
        if (e.on === "actor" && !["tap", "miss"].includes(r.when) && !(r.a && has(r.a))) E(at + ": on actor braucht tap/miss oder ein a");
        if (e.act === "win" || e.act === "lose") decides = true;
        if (e.on === "seat1" && d.players < 2 && (e.act === "win" || e.act === "lose")) E(at + ": seat1 gibt es nur bei 2 Spielern");
      }
      if (r.when === "clear" && r.do.some((e) => e.act === "win" || e.act === "lose")) decides = true;
      // zu zweit muss jede Wertung einen Sitz erreichen (ein Ball gehoert niemandem: seat0/seat1 statt a/other)
      if (d.players === 2) for (const e of r.do) {
        if (!["score", "life", "win", "lose"].includes(e.act)) continue;
        const reach = e.on === "seat0" || e.on === "seat1" || e.on === "all" || (e.on === "a" && owned(r.a)) || (e.on === "b" && owned(r.b))
          || ((e.on === "actor" || e.on === "other") && (["tap", "miss"].includes(r.when) || owned(r.a) || owned(r.b)));
        if (!reach) E(at + ": " + e.act + " auf " + e.on + " erreicht keinen Sitz (" + (r.a || "-") + " gehoert niemandem; seat0/seat1 nutzen)");
      }
    });
    if (!decides) E("kein Ende: end.time, end.score, end.lives oder eine Regel mit win/lose noetig");
    // Rechenaufwand je Tick abschaetzen (Security-Review M5): hoechstens so viele Dinge je Art wie Start + Erzeuger-Maximum
    // (bzw. die Laufzeitgrenze), Paarpruefungen = Summe ueber die Beruehrungsregeln; dazu feste Dinge gegen alle
    const most = (id) => Math.min(LIMITS.alive, d.start.filter((p) => p.thing === id).reduce((s, p) => s + p.n, 0) * (d.players === 1 ? 2 : 1) + d.spawn.filter((s) => s.thing === id).reduce((s, x) => s + x.max, 0) + (d.rules.some((r) => r.do.some((e) => e.act === "spawn" && e.thing === id)) ? 40 : 0));
    const all = d.things.reduce((s, t) => s + most(t.id), 0);
    const pairs = d.rules.filter((r) => r.when === "touch").reduce((s, r) => s + most(r.a) * (has(r.b) ? most(r.b) : 0), 0) + d.things.filter((t) => t.solid).reduce((s, t) => s + most(t.id), 0) * all;
    if (pairs > LIMITS.pairs) E("zu viel Rechenaufwand: bis zu " + pairs + " Paarpruefungen je Tick (Grenze " + LIMITS.pairs + "); weniger Dinge gleicher Art oder weniger Beruehrungsregeln"); 
    // jede Seite braucht etwas zu tun
    for (let s = 0; s < d.players; s++) {
      const own = d.start.some((p) => p.seat === s && has(p.thing) && !["none", "tap"].includes(thing(p.thing).control));
      const taps = d.things.some((t) => t.control === "tap") || d.rules.some((r) => r.when === "miss");
      if (!own && !taps) E("Sitz " + s + " hat keine Steuerung (ein Ding mit control und seat " + s + ", oder antippbare Dinge)");
    }
    if (d.end.win === "survive" && d.end.lives === 0 && !d.rules.some((r) => r.do.some((e) => e.act === "lose" || e.act === "life"))) E("win survive braucht Leben oder lose-Regeln");
    if (d.bot.kind !== "none") {
      if (d.bot.thing && !has(d.bot.thing)) E("bot.thing " + d.bot.thing + " fehlt");
      if (d.bot.target && !has(d.bot.target)) E("bot.target " + d.bot.target + " fehlt");
      if (["track", "flap", "jump", "seek", "dodge"].includes(d.bot.kind) && !d.bot.thing) E("bot " + d.bot.kind + " braucht bot.thing");
      if (d.bot.thing && !owned(d.bot.thing)) E("bot.thing " + d.bot.thing + " gehoert keinem Sitz (start mit seat 0/1)");
      if (["track", "jump", "seek", "tap"].includes(d.bot.kind) && !d.bot.target) E("bot " + d.bot.kind + " braucht bot.target");
    }
  } else {
    const T = d.turn;
    if (T.kind === "none") E("turn.kind fehlt");
    if (T.kind === "place") {
      if (T.cols < 3 || T.rows < 3) E("place: Brett mindestens 3x3");
      if (!T.drop && T.cols * T.rows > LIMITS.cells) E("place: hoechstens " + LIMITS.cells + " Felder ohne drop");
      if (T.line < 3 || T.line > Math.max(T.cols, T.rows)) E("place: line 3.." + Math.max(T.cols, T.rows));
      if (T.pieces.length !== 2 || !T.pieces.every(has)) E("place: pieces braucht zwei Dinge");
      for (const p of T.pieces) if (has(p) && !(emojiOk(thing(p).emoji) || thing(p).text)) E("place: Stein " + p + " braucht emoji oder text");
    }
    if (T.kind === "flip") {
      if (T.pairs.length < 2) E("flip: mindestens 2 Paare");
      if (T.pairs.some((p) => !p)) E("flip: leeres Paar");
      if (new Set(T.pairs).size !== T.pairs.length) E("flip: Paare doppelt");
      if (T.pairs.length * 2 > LIMITS.cells) E("flip: hoechstens " + LIMITS.cells / 2 + " Paare");
      if (T.cols * T.rows !== T.pairs.length * 2) E("flip: cols x rows muss 2 x Paare sein (" + T.pairs.length * 2 + ")");
    }
    if (T.kind === "answer") {
      if (T.items.length < 3) E("answer: mindestens 3 Fragen");
      T.items.forEach((it, i) => {
        if (T.ask === "pick" && it.wrong.filter(Boolean).length < 1) E("answer: Frage " + (i + 1) + " braucht falsche Antworten");
        if (it.wrong.some((w) => w && w.toLowerCase() === it.a.toLowerCase())) E("answer: Frage " + (i + 1) + ": falsche Antwort gleich der richtigen");
        if (T.form !== "plain" && [...it.a.replace(/\s/g, "")].length < 3) E("answer: Frage " + (i + 1) + ": Wort zu kurz fuer " + T.form);
      });
      if (T.rounds > T.items.length) E("answer: rounds > Fragen");
    }
  }
  return { ok: errors.length === 0, desc: d, errors, notes };
}
