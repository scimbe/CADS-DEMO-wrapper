// zug-wette "Versprochen ist versprochen" – Altregel turns.js:175-184 (GAMES.wette): Versprechen + Frist; der andere urteilt
// erst nach Ablauf (gateFrom: Frist ab dem ersten Zug; die Uhr ist Spiel, kein Schloss).
import { D, T, pair, pk } from "../../engines/zug-z2/lib.js";

export default {
  gateFrom: 1,
  turns: [
    [{ w: "pick", l: "wet_pick", n: 1, from: (doc, m, now, lang) => D.vows.map((x, i) => pair(D.vows, i, lang)) }, { w: "slide", l: "wet_days", min: 1, max: 7, def: 3 }],
    [{ w: "pick", l: "wet_judge", n: 1, from: (doc, m, now, lang) => [T(lang).wet_yes, T(lang).wet_no] }]
  ],
  gate: (doc, m) => (m.length === 1 ? doc.o : 0),
  peekWhole: (doc, m, lang) => (m.length === 1 ? pair(D.vows, m[0][0][0], lang) : ""),
  result(doc, m, lang) { const X = T(lang); return { h: m[1][0][0] === 0 ? X.wet_done : X.wet_fail, lines: [pair(D.vows, m[0][0][0], lang)].concat(m[1][0][0] === 0 ? [] : [pk(D.forfeit[0], lang)]) }; }
};
