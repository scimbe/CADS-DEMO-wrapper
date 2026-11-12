// raum-erklaeren "60 Sekunden Erklären" – Altregel turns.js:837-840 (GAMES.erklaeren): Begriffe aus dem Seed, eine Minute, gezaehlt
// wird, was die Runde errät. Ein Geraet.
import { D, T, fmt, pair, mix } from "../../engines/zug-z2/lib.js";

export default {
  local: true,
  turns: [[{ w: "explain", l: "exp_go", auto: true, secs: 60, max: 99, list: (doc, lang) => mix(doc, "erkl", D.words.length).map((i) => pair(D.words, i, lang)) }]],
  result(doc, m, lang) { return { h: fmt(T(lang).exp_h, { n: m[0][0] }), lines: [T(lang).exp_note] }; }
};
