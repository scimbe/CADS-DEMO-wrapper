// zug-auftrag "Ich geb dir eine Aufgabe" – Altregel turns.js:225-230 (GAMES.auftrag): beide waehlen eine Aufgabe fuer den anderen.
// Variante "mut": die eingeklappten Mutkarten mut-* (ideas.json, to: zug-auftrag) als Aufgabenliste, gleicher Ablauf.
import { D, T, fmt, pair } from "../../engines/zug-z2/lib.js";
import MUT from "./mut.json" with { type: "json" };

function make(list) {
  const from = (doc, m, now, lang) => list.map((x, i) => pair(list, i, lang));
  return {
    turns: [[{ w: "pick", l: "job_pick", n: 1, from }], [{ w: "pick", l: "job_pick", n: 1, from }]],
    result(doc, m, lang) { const X = T(lang), l = from(doc, m, [], lang); return { h: X.job_h, lines: [fmt(X.job_a, { w: l[m[1][0][0]] }), fmt(X.job_b, { w: l[m[0][0][0]] })] }; }
  };
}
export const auftrag = make(D.jobs);
export const mut = make(MUT.lines);
export const GAMES = { auftrag, mut };
export default auftrag;
