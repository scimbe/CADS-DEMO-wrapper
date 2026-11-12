// Gemeinsame Quiz-Engine (alt:src/quizpack.js), Regel für Regel portiert: ein Fragepaket (Nachtpaket, Thema oder
// eigener Text) für Frag mich ab, Quiz, Typen und Schätzen. Rein (kein DOM, kein Netz, keine Uhr). Das Paket reist im
// Link (params.pk); Zahlen rechnet nie ein Modell aus: eine Schätzzahl ist eine Antwort, wie sie dasteht, und das Ende
// des Schiebers kommt aus dem Seed. Gleicher Seed + gleiches Paket => gleiche Reihenfolgen wie im Altcode (seed32).
import { seeded, mixIndex } from "../seed32/seed32.js";
import { isClean } from "./clean.js";

// Paket: t Titel, m Modus (l Lernen, f Firma: allein und ohne Rangliste, g Gruppe: nur Stärken), q Fragen
// [[Frage, Antwort, falsch, falsch, falsch?]] bzw. bei g [[Frage, [Text, Typ], ...]], z je Frage eine ganze Zahl oder 0
// (Schätzen), y [[Typ, Stärke]] bei g, u eine Einheit je Frage (Schätzen der freien Karte: q [[Frage]], z vom Sender).
export const MODES = { lernen: "l", firma: "f", gruppe: "g" };
export const MAX_Q = 8, MIN_Q = 3, F = 120, A = 60, ZMAX = 999999;
export const GAMES = { abfragen: 1, luecke: 1, woerter: 1, schaetzen: 1, quiz: 1, typen: 1 };
export const CHOICE = { luecke: 1, quiz: 1 };

function txt(v, max) {
  const s = Array.from(String(v === undefined || v === null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
  return s && isClean(s) && !/https?:|www\.|:\/\//i.test(s) ? s : "";
}
export function fold(s) { return String(s).toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, ""); }

/** "8", "1.000", "4 000" -> 8, 1000, 4000; alles mit Einheit, Komma, führender Null oder mehreren Zahlen -> 0. */
export function whole(a) {
  const s = String(a).trim();
  if (!/^[1-9]\d{0,2}([. ]\d{3})*$|^[1-9]\d{0,5}$/.test(s)) return 0;
  const n = Number(s.replace(/[. ]/g, ""));
  return n >= 2 && n <= ZMAX ? n : 0;
}

/** Paket aus dem Link oder null. Jeder Text durch den Wortfilter; eine Frage mit doppelten Antworten fällt weg. */
export function sanitize(o) {
  if (!o || typeof o !== "object" || ["l", "f", "g"].indexOf(o.m) < 0 || !Array.isArray(o.q)) return null;
  const t = txt(o.t, 40), p = { t, m: o.m, q: [] };
  if (!t) return null;
  if (o.m === "g") {
    p.y = (Array.isArray(o.y) ? o.y : []).slice(0, 4).map((y) => (Array.isArray(y) ? [txt(y[0], 26), txt(y[1], 90)] : null)).filter((y) => y && y[0] && y[1]);
    if (p.y.length < 2) return null;
    o.q.slice(0, MAX_Q).forEach((q) => {
      if (!Array.isArray(q)) return;
      const f = txt(q[0], F), as = q.slice(1, 5).map((a) => (Array.isArray(a) && Number.isInteger(a[1]) && a[1] >= 0 && a[1] < p.y.length ? [txt(a[0], 56), a[1]] : null)).filter((a) => a && a[0]);
      if (f && as.length >= 2 && new Set(as.map((a) => fold(a[0]))).size === as.length) p.q.push([f].concat(as));
    });
  } else {
    const z = [], u = Array.isArray(o.u) ? [] : null;
    o.q.slice(0, MAX_Q).forEach((q, i) => {
      if (!Array.isArray(q)) return;
      const row = u ? [txt(q[0], 80)] : [txt(q[0], F)].concat(q.slice(1, 5).map((a) => txt(a, A)).filter(Boolean));
      // nur die Antwort (Frag mich ab, Wörter, Schätzen brauchen keine falschen) oder mit zwei oder drei falschen
      if (!row[0] || (!u && (row.length === 3 || row.length < 2 || new Set(row.slice(1).map(fold)).size !== row.length - 1))) return;
      // eine ungültige Zahl (NaN, zu groß, nicht die Antwort) nimmt ihre Frage mit; mit u braucht jede eine
      const n = Array.isArray(o.z) ? o.z[i] : 0, ok = Number.isInteger(n) && n >= 2 && n <= ZMAX && (u || whole(row[1]) === n);
      if (!ok && (u || (n !== 0 && n !== undefined && n !== null))) return;
      p.q.push(row); z.push(ok ? n : 0);
      if (u) u.push(txt(o.u[i], 8));
    });
    if (z.some(Boolean)) p.z = z;
    if (u) p.u = u;
  }
  return p.q.length >= MIN_Q ? p : null;
}

// ---------- Spiele mit Paket: dieselbe Reihenfolge auf beiden Handys, aus dem Seed ----------
// doc = { seed, pk, g } wie im Altcode (seed: Zeichenkette oder Zahl)
export function mix(doc, tag, n) { return mixIndex(seeded("pk|" + doc.seed + "|" + tag), n); }
function q(doc) { return doc.pk.q; }
export function choices(doc, i) { const row = q(doc)[i]; return mix(doc, "c" + i, row.length - 1).map((k) => row[k + 1]); }
export function rightAt(doc, i) { return choices(doc, i).indexOf(q(doc)[i][1]); }
/** Wörter: die Antwort steht da, zu welcher Frage gehört sie? Die richtige und zwei andere, gemischt. */
export function others(doc, i) { const n = q(doc).length, o = mix(doc, "w" + i, n).filter((k) => k !== i).slice(0, 2); return mix(doc, "wo" + i, 3).map((k) => [i].concat(o)[k]); }
export function nums(doc) { const z = doc.pk.z || []; return q(doc).map((x, i) => i).filter((i) => z[i] > 0); }
/** Typen: Antworten einer Frage in der Reihenfolge des Seeds. */
export function typeChoices(doc, i) { return mix(doc, "t" + i, q(doc)[i].length - 1).map((k) => q(doc)[i][k + 1][0]); }

// Exakt statt Math.log10/Math.pow (nicht exakt spezifiziert): floor(log10(v)) durch Vergleich mit exakten Zehnerpotenzen.
const POW10 = [1e-3, 1e-2, 1e-1, 1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9];
export function floorLog10(v) { let k = -3; while (k < 9 && v >= POW10[k + 4]) k++; return k; }
export function pow10(k) { return POW10[k + 3]; }

/** Ende des Schiebers aus dem Seed: die Zahl liegt gleichverteilt zwischen 1/5 und 4/5, das Ende auf zwei Stellen
 *  aufgerundet (37, 4100), damit weder die Mitte noch ein rundes Ende sie verrät. */
export function top(doc, i) {
  const z = doc.pk.z[i], v = z / (0.2 + 0.6 * seeded("pk|" + doc.seed + "|z" + i)());
  const p = Math.max(1, pow10(floorLog10(v) - 1));
  return Math.min(ZMAX * 3, Math.max(z + 1, Math.ceil(v / p) * p));
}

/** Antworten einer Person -> wie viele richtig, welche offen; bei Schätzen der Abstand je Frage.
 *  a wie im Altcode: abfragen [0, [k], 0, [k], ...] (show, pick je Frage), sonst [[k], ...]; schaetzen [Zahl, ...]. */
export function score(doc, g, a) {
  const X = q(doc); let ok = 0; const open = [];
  if (g === "schaetzen") return nums(doc).map((i, k) => Math.abs(a[k] - doc.pk.z[i]));
  X.forEach((row, i) => {
    const hit = g === "abfragen" ? a[i * 2 + 1][0] === 0 : g === "woerter" ? others(doc, i)[a[i][0]] === i : a[i][0] === rightAt(doc, i);
    if (hit) ok++; else open.push(row[0] + " → " + row[1]);
  });
  return { ok, n: X.length, open };
}

/** Typen: der Typ, auf den die meisten Antworten zeigen; Gleichstand entscheidet der Seed, nie eine Regel. */
export function typeOf(doc, a) {
  const c = doc.pk.y.map(() => 0), order = mix(doc, "ty", c.length);
  q(doc).forEach((row, i) => { const k = mix(doc, "t" + i, row.length - 1)[a[i][0]]; c[row[k + 1][1]]++; });
  return order.reduce((b, i) => (c[i] > c[b] ? i : b), order[0]);
}

/** Ein Spiel geht mit diesem Paket: Lern- und Firmenpakete für vier Karten und das Team-Quiz, Gruppenpakete für Typen,
 *  Schätzen nur mit mindestens drei Zahlen, ein Paket mit u nur für Schätzen. */
export function fits(g, p) {
  return !!p && GAMES[g] === 1 && (g === "typen" ? p.m === "g" : p.m !== "g") && (g === "schaetzen" ? (p.z || []).filter(Boolean).length >= 3 : !p.u) &&
    (!CHOICE[g] || p.q.every((r) => r.length >= 4));
}

/** Ablauf wie alt quizpack.game: Lernen: zwei Züge, beide spielen; Firma/Gruppe: Sender schickt nur, jede Person spielt
 *  allein (stay); freie Karte (u, Lernen): Sender schickt nur, eine Person spielt. -> "l" | "stay" | "free" | null */
export function flow(g, p) {
  if (!fits(g, p)) return null;
  if (p.u && p.m === "l") return "free";
  return p.m === "l" ? "l" : "stay";
}
