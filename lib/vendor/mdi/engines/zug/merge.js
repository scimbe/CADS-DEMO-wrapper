// Gemeinsame Liste im Link mit Vereinigungs-Merge (Altregel turns.js:896-981, woertlich in der Semantik).
// Eine Liste ist [personen, eintraege]. personen: [[name, gesicht]], gesicht = Index in FACES. eintraege:
// [[text, t, menge, marken]]; t ordnet (wer hinzufuegt, haengt hinter alles Gesehene), marken: [[person, x]] mit
// x = version * 3 + s, s 0 nichts, 1 "bringe ich", 2 "gekauft". Merge ist eine Vereinigung: ein Eintrag je gefaltetem
// Text (kleineres t, groessere Menge, kleinerer Text bei Gleichstand), eine Marke je Eintrag und Person, das groessere
// x gewinnt. Reihenfolge und Wiederholung eingehender Antworten sind egal (kommutativ, assoziativ, idempotent).
// Geloescht wird nie; nur die Grenzen schneiden ab: was zuletzt sortiert, passt nicht mehr in den Link.
import { clean, fold, intIn, distinct } from "./alt.js";

export const SHOP = Object.freeze({ items: 20, text: 24, people: 8, min: 1, qty: 99, ver: 999, t: 999, bytes: 560 });
export const WISH = Object.freeze({ items: 10, text: 32, people: 10, min: 1, qty: 1, ver: 999, t: 999, bytes: 600, wish: true });
export const FACES = Object.freeze(["🐸", "🦝", "🐙", "🦖", "🍕", "👽", "🤖", "👻", "🔥", "🌈", "🦄", "🐝"]);

export function nameOk(v) { return typeof v === "string" && !!fold(v) && clean(v, 12) === v && new TextEncoder().encode(v).length <= 24; }
export function shopKey(s) { return fold(s); }
function bytes(v) { return new TextEncoder().encode(JSON.stringify(v)).length; }
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

export function shopOk(v, cf) {
  const S = cf || SHOP;
  if (!Array.isArray(v) || v.length !== 2 || !Array.isArray(v[0]) || !Array.isArray(v[1])) return false;
  const P = v[0], I = v[1];
  if (P.length > S.people || !I.length || I.length > S.items || bytes(v) > S.bytes) return false;
  const okP = P.every((p) => Array.isArray(p) && p.length === 2 && nameOk(p[0]) && intIn(p[1], 0, FACES.length - 1));
  const okI = okP && I.every((it) => {
    if (!Array.isArray(it) || it.length !== 4 || typeof it[0] !== "string" || clean(it[0], S.text) !== it[0] || !shopKey(it[0])) return false;
    if (!intIn(it[1], 0, S.t) || !intIn(it[2], S.min, S.qty) || !Array.isArray(it[3])) return false;
    return it[3].every((k) => Array.isArray(k) && k.length === 2 && intIn(k[0], 0, P.length - 1) && intIn(k[1], 1, S.ver * 3 + 2)) && distinct(it[3].map((k) => k[0]));
  });
  return okI && distinct(P.map((p) => fold(p[0]))) && distinct(I.map((it) => shopKey(it[0])));
}
// In Tabellen nach gefaltetem Text und Namen, und zurueck in die eine Reihenfolge, die jedes Handy baut.
// Tabellen ohne Prototyp: ein Eintrag "Constructor" oder ein Name "toString" darf nie geerbte Schluessel treffen
// (Review 2026-11-12 H1; der Altcode hatte denselben Fehler mit {}).
const table = () => Object.create(null);
function open(list, into) {
  const o = into || { people: table(), items: table() };
  if (!list) return o;
  list[1].forEach((it) => {
    const k = shopKey(it[0]);
    let x = o.items[k];
    if (!x) x = o.items[k] = { text: it[0], t: it[1], qty: it[2], marks: table() };
    else { if (it[0] < x.text) x.text = it[0]; x.t = Math.min(x.t, it[1]); x.qty = Math.max(x.qty, it[2]); }
    it[3].forEach((m) => { const p = fold(list[0][m[0]][0]); x.marks[p] = Math.max(x.marks[p] || 0, m[1]); });
  });
  list[0].forEach((p) => { const k = fold(p[0]), x = o.people[k]; if (!x) o.people[k] = [p[0], p[1]]; else { if (p[0] < x[0]) x[0] = p[0]; x[1] = Math.min(x[1], p[1]); } });
  return o;
}
function close(o, cf) {
  const S = cf || SHOP, keys = Object.keys(o.items).sort((a, b) => o.items[a].t - o.items[b].t || cmp(a, b)).slice(0, S.items);
  for (;;) {
    const used = Object.keys(o.people).filter((p) => keys.some((k) => o.items[k].marks[p] > 0)).sort(cmp).slice(0, S.people);
    const v = [used.map((p) => o.people[p].slice()), keys.map((k) => {
      const x = o.items[k];
      return [x.text, x.t, x.qty, used.map((p, i) => [i, x.marks[p] || 0]).filter((m) => m[1] > 0)];
    })];
    if (bytes(v) <= S.bytes || keys.length <= 1) return v;
    keys.pop();
  }
}
export function shopMerge(a, b, cf) { return close(open(b, open(a)), cf); }
/** "2× Milch", "2x Milch", "2 Milch": Menge 1–99 vorn, der Rest ist der Text (turns.js:952; ein Argument, map-fest). */
export function shopParse(s) {
  let raw = String(s == null ? "" : s).trim(), qty = 1;
  const m = raw.match(/^(\d{1,2})\s*[x×*]?\s+(\S.*)$/i) || raw.match(/^(\d{1,2})\s*[x×*]\s*(\S.*)$/i);
  if (m && +m[1] >= 1) { qty = +m[1]; raw = m[2]; }
  const text = clean(raw, SHOP.text);
  return text && shopKey(text) ? { text, qty } : null;
}
export function shopMark(list, name, key) {
  let at = -1; const p = fold(name);
  list[0].forEach((q, i) => { if (fold(q[0]) === p) at = i; });
  const it = list[1].filter((x) => shopKey(x[0]) === key)[0], m = it && it[3].filter((k) => k[0] === at)[0];
  return m ? m[1] : 0;
}
/** Aenderungen einer Person auf dem, was sie bekam: neue Eintraege hinter allem Gesehenen, dann eigene Marken je eine
 *  Version ueber der erhaltenen – sie gewinnen gegen das Gesehene und verlieren gegen spaetere Aenderungen anderer. */
export function shopApply(base, e, cf) {
  const S = cf || SHOP, o = open(base), p = nameOk(e.name) ? fold(e.name) : "";
  let t = 0;
  Object.keys(o.items).forEach((k) => { t = Math.max(t, o.items[k].t + 1); });
  (e.adds || []).forEach((a) => { open([[], [[a.text, Math.min(S.t, t++), a.qty, []]]], o); });
  if (p) {
    if (!o.people[p]) o.people[p] = [e.name, intIn(e.face, 0, FACES.length - 1) ? e.face : 0];
    Object.keys(e.marks || {}).forEach((k) => {
      if (!Object.prototype.hasOwnProperty.call(e.marks, k)) return;
      const s = e.marks[k], had = base ? shopMark(base, e.name, k) : 0;
      if (!o.items[k] || !intIn(s, 0, 2) || (had ? had % 3 === s : s === 0)) return;
      o.items[k].marks[p] = Math.min(S.ver, Math.floor(had / 3) + 1) * 3 + s;
    });
  }
  return close(o, S);
}
export function shopRows(list, cf) {
  return list[1].map((it) => {
    const who = (s) => it[3].filter((m) => m[1] % 3 === s).map((m) => list[0][m[0]]);
    return { key: shopKey(it[0]), text: it[0], qty: it[2], label: (cf && cf.due) || it[2] <= 1 ? it[0] : it[2] + "× " + it[0], due: cf && cf.due ? it[2] : 0, bought: who(2), bring: who(1) };
  });
}
export function shopDone(list) { return !!list && list[1].length > 0 && shopRows(list).every((r) => r.bought.length > 0); }
/** Die Liste der wuenschenden Person: nur die Wuensche, keine Marke, keine Personen (turns.js:999). */
export function wishBare(v) { return [[], v[1].map((it) => [it[0], it[1], 1, []])]; }
export function shopNames(l) { return l.map((p) => p[0]).join(", "); }
