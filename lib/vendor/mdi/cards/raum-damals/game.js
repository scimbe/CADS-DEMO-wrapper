// raum-damals "Damals mit 13" – Altregel turns.js:349-354 (GAMES.damals): fuenf Erinnerungsfragen, eine Person schreibt, die Runde liest.
import { D, T, pair } from "../../engines/zug-z2/lib.js";

function pastAsk(i) { return { w: "text", l: "dam_q", max: 44, top: (doc, m, lang) => pair(D.past, i, lang) }; }
export default {
  local: true, turns: [[0, 1, 2, 3, 4].map(pastAsk)],
  result(doc, m, lang) { return { h: T(lang).dam_h, lines: m[0].map((a, i) => pair(D.past, i, lang) + " " + a) }; }
};
