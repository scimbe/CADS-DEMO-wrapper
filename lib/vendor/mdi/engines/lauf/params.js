// Parameter der Lauf-Engine E3 (Runner/Plattformer), exakt aus alt:src/lauf.js (Dokument) und alt:src/lauf-engine.js
// (LEVELS, HAS, build). Ein neues Spiel sind neue Zahlen hier, kein neuer Code. Dazu die Bruecke zum Server der
// freien Karte (Genre G2, CADS-DEMO-wrapper lib/duell-karte.mjs compose("lauf") = build(...)).
import { sanitizeAnim } from "../flug/params.js";
import { isClean } from "../flug/text.js";

// name: [min, max, default]. g Schwere, j Sprung, v Starttempo, a Zuwachs je 1000 px, vm Hoechsttempo (px/s); dann
// Chancen in % je Abschnitt: lu Luecke, hi Hindernis, du Balken zum Ducken, mu Muenzen, ge Gegner, fa von oben;
// lw Lueckenbreite in % des sicheren Sprungs, hv Hoehenwechsel, len Strecke bis zum Ziel in m (Modus "ziel")
export const SPEC = { g: [900, 3200, 2000], j: [400, 1000, 680], v: [100, 420, 190], a: [0, 40, 8], vm: [120, 520, 360], lu: [0, 80, 35], lw: [20, 100, 75],
  hi: [0, 90, 40], du: [0, 60, 0], mu: [0, 100, 50], ge: [0, 80, 20], fa: [0, 80, 0], hv: [0, 100, 30], len: [100, 3000, 600] };
// Engine-Version: 1 = deterministischer Lauf (Festkomma-Flugbahn, Eingaben am Tick). Ohne ev = Version 0 (alte Links).
export const EV = 1;
export const MODES = ["endlos", "ziel"], WORLDS = ["bruecke", "stadt", "wald", "wueste", "eis", "nacht", "lava", "candy"], PATTERNS = ["geh", "huepf", "flug"];
export const FIG = ["🏃", "🐸", "🦊", "🐱", "🐶", "🦖", "🐧", "🐰", "🤖", "👾", "🦄", "🐢", "🐹", "🦝", "🐼", "🐵"];
export const OBJ = ["📦", "🪨", "🌵", "🧱", "🍄", "🪵", "🧊", "🔥", "🌲", "🎁", "⛄", "🎃"];
export const COIN = ["🪙", "⭐", "💎", "🍎", "🍓", "🍩", "🍪", "🥕", "🍒", "🌟", "💛", "🍬"];
export const FOE = ["🐌", "🦀", "🐝", "🦇", "🐞", "🦔", "👻", "🐙", "🐦", "🦆", "🐭", "🐊"];
function one(list, v) { return list.indexOf(v) >= 0 ? v : list[0]; }
export function sanitize(o) {
  o = o && typeof o === "object" ? o : {};
  const p = o.p && typeof o.p === "object" ? o.p : {}, q = {};
  for (const k of Object.keys(SPEC)) { const s = SPEC[k], n = Math.round(Number(p[k])); q[k] = p[k] != null && isFinite(n) ? Math.min(s[1], Math.max(s[0], n)) : s[2]; }
  q.vm = Math.max(q.vm, q.v);
  q.j = Math.min(q.j, Math.floor(Math.sqrt(300 * q.g)));   // der hoechste Sprung bleibt im Bild
  const fp = PATTERNS.filter((x) => Array.isArray(o.fp) && o.fp.indexOf(x) >= 0);
  const l = { m: one(MODES, o.m), seed: Number.isInteger(o.seed) && o.seed >= 0 && o.seed <= 4294967295 ? o.seed : 1, w: one(WORLDS, o.w), e: one(FIG, o.e), o: one(OBJ, o.o), c: one(COIN, o.c), f: one(FOE, o.f), fp: fp.length ? fp : ["geh"], p: q };
  if (Number.isInteger(o.r) && o.r > 0 && o.r < 1e6) l.r = o.r;
  if (Number.isInteger(o.ev) && o.ev >= 1 && o.ev < 1e3) l.ev = o.ev;
  const an = sanitizeAnim(o.anim); if (an) l.anim = an;
  return l;
}

// Slots der KI (Server-Schema) oder Wortregeln -> ein Spiel. Zahlen sind nie die des Modells: das Level waehlt sie.
export const LEVELS = { easy: { g: 1700, j: 680, v: 160, a: 5, vm: 280, hv: 20, lw: 55, k: 0.7, len: 400 }, normal: { g: 2000, j: 700, v: 200, a: 9, vm: 360, hv: 35, lw: 75, k: 1, len: 700 }, hard: { g: 2300, j: 740, v: 250, a: 14, vm: 460, hv: 60, lw: 90, k: 1.3, len: 1000 } };
export const HAS = { luecken: ["lu", 40], hindernisse: ["hi", 40], ducken: ["du", 25], muenzen: ["mu", 60], gegner: ["ge", 30], von_oben: ["fa", 35] };
export function build(o, seed) {
  o = o || {};
  const lv = LEVELS[o.level] || LEVELS.normal, has = Array.isArray(o.has) ? o.has : [], p = { g: lv.g, j: lv.j, v: lv.v, a: lv.a, vm: lv.vm, hv: lv.hv, lw: lv.lw, len: lv.len };
  for (const k of Object.keys(HAS)) p[HAS[k][0]] = has.indexOf(k) >= 0 ? Math.round(HAS[k][1] * lv.k) : 0;
  if (o.world === "bruecke") p.lu = Math.max(p.lu, Math.round(45 * lv.k));
  if (Number.isInteger(o.len)) p.len = o.len;
  return sanitize({ ev: EV, m: o.mode, seed: seed >>> 0, w: o.world, e: o.figure, o: o.obstacle, c: o.coin, f: o.foe, fp: o.foes, p });
}

// ---------- Dokument "lauf" und die freie Karte (Server G2) ----------
const HEX = /^#[0-9a-fA-F]{6}$/;
function colors(c) { return Array.isArray(c) && c.length === 2 && HEX.test(c[0]) && HEX.test(c[1]) ? [c[0], c[1]] : ["#ffd400", "#ff3b1d"]; }
export function txt(s, max) {
  const t = Array.from(String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
  return t && isClean(t) ? t : "";
}
function kiDoc(o) {
  // Siegel der freien Karte (k karte) bzw. der KI-Welt (k welt): ohne Signatur s kein Siegel (Manifest-Schema ki)
  if (!o || typeof o !== "object" || ["karte"].indexOf(o.k) < 0) return null;
  if (typeof o.s !== "string" || !/^[A-Za-z0-9._~-]{8,200}$/.test(o.s)) return null;
  const r = { k: o.k, s: o.s };
  if (r.s && typeof o.h === "string" && /^[A-Za-z0-9_-]{43}$/.test(o.h)) r.h = o.h;
  if (r.s && typeof o.o === "string" && /^[A-Za-z0-9_-]{22}$/.test(o.o)) r.o = o.o;
  return r;
}
// Spur der Bearbeiter (alt daily.js sanitizeTrail): [{n, w:[Bereiche]}], hoechstens 8, Namen bereinigt
const AREAS = ["text", "farbe", "sticker", "regeln", "figur", "welt", "bild", "musik", "stimme", "frage"];
export function trail(by) {
  return (Array.isArray(by) ? by : []).map((e) => {
    if (!e || typeof e !== "object") return null;
    const w = (Array.isArray(e.w) ? e.w : []).filter((x) => AREAS.indexOf(x) >= 0).slice(0, AREAS.length);
    return w.length ? { n: txt(e.n, 16), w } : null;
  }).filter(Boolean).slice(-8);
}
// ---------- Kartenparameter der Karte "lauf": das Dokument l flach (p-Schluessel oben), dazu Farben, Titel, Siegel ----------
export const PKEYS = Object.keys(SPEC);
/** Dokument l (sanitize) aus Kartenparametern. */
export function laufOf(params) {
  const q = params || {}, p = {};
  for (const k of PKEYS) if (q[k] != null) p[k] = q[k];
  return sanitize({ ev: q.ev == null ? undefined : q.ev, m: q.m, seed: q.seed, w: q.w, e: q.e, o: q.o, c: q.c, f: q.f, fp: q.fp, p, r: q.r == null ? undefined : q.r, anim: q.anim });
}
export function paramsOfLauf(l, rest) {
  const s = sanitize(l), out = { m: s.m, seed: s.seed, w: s.w, e: s.e, o: s.o, c: s.c, f: s.f, fp: s.fp.slice(), ev: s.ev == null ? null : s.ev, anim: s.anim || null, r: s.r == null ? null : s.r };
  for (const k of PKEYS) out[k] = s.p[k];
  return Object.assign(out, { col: ["#2b4bff", "#ffe600"], t: "", ki: null, fr: null }, rest || {});
}
// Kartenparameter aus einem Server-Dokument (G2) oder alten Link {k:"lauf", col, by, t, ki?, fr?, l}. null: kein Laufspiel.
export function fromServerDoc(doc) {
  if (!doc || typeof doc !== "object" || doc.k !== "lauf") return null;
  const rest = { col: colors(doc.col), by: trail(doc.by) };
  const t = txt(doc.t, 40); if (t) rest.t = t;
  const ki = kiDoc(doc.ki); if (ki) rest.ki = ki;
  if (typeof doc.fr === "string" && /^[A-Za-z0-9_-]{22}$/.test(doc.fr)) rest.fr = doc.fr;
  return paramsOfLauf(doc.l, rest);
}
export function toServerDoc(params, base) {
  const p = params || {}, b = base && typeof base === "object" ? base : {};
  const doc = { k: "lauf", col: colors(p.col || b.col), by: trail(Array.isArray(p.by) ? p.by : b.by), l: laufOf(p) };
  const t = txt(p.t, 40); if (t) doc.t = t;
  if (typeof p.fr === "string" && /^[A-Za-z0-9_-]{22}$/.test(p.fr)) doc.fr = p.fr;
  const ki = kiDoc(p.ki); if (ki) doc.ki = ki;
  return doc;
}
