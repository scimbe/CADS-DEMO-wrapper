// Gemeinsame Hilfen der Z2-Zugkarten: dieselben Bausteine wie turns.js:9-37 (Altcode), ohne DOM, ohne Uhr, ohne Zufall
// ausser dem Seed. Alles Grundlegende kommt aus dem Zug-Kern (src/engines/zug/alt.js, Strang Z1); hier nur die
// doc-Schreibweise der Altregeln (mix(doc, …)) und kleine Listenhelfer.
import D from "../zug/turn.json" with { type: "json" };
import { mix as mixSeed, fmt, fold, clean, hash32, mulberry32, num, pk, alt, pair, side, textsFor } from "../zug/alt.js";

export { D, fmt, fold, clean, hash32, mulberry32, num, pk, alt, pair, side };
/** Textblock einer Sprache, Luecken aus dem deutschen Block (core.js textsFor). */
export function T(lang) { return textsFor(D.text, lang); }
export function listOf(k) { return (doc, m, now, lang) => D[k].map((x, i) => pair(D[k], i, lang)); }
/** gleiche Reihenfolge auf beiden Geraeten aus dem Seed (turns.js:18 mix) */
export function mix(doc, tag, n) { return mixSeed(doc.seed, tag, n); }
export function hits(a, b) { return a.filter((x) => b.indexOf(x) >= 0); }
export function places(order) { const p = []; order.forEach((o, at) => { p[o] = at; }); return p; }
