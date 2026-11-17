// raum-maus "Drück mich" – Altregel turns.js:720-726 (GAMES.maus): fuer wen, Stimmeffekt, 4 s aufnehmen; die beschenkte Person
// drueckt einmal, danach ist die Aufnahme weg. Nichts verlaesst das Geraet.
import { T, fmt } from "../../engines/zug-z2/lib.js";

export const FXS = ["chip", "monster", "robot", "echo"];
export default {
  local: true,
  turns: [[{ w: "text", l: "mau_for", max: 12 }, { w: "pick", l: "mau_fx", n: 1, auto: true, from: (doc, m, now, lang) => FXS.map((f) => T(lang)["mau_" + f]) }, { w: "rec", l: "mau_rec", auto: true, ms: 4000, slot: "maus" }],
    [{ w: "once", l: "mau_press", auto: true, slot: "maus", fx: (m) => FXS[m[0][1][0]], who: (m) => m[0][0] }]],
  result(doc, m, lang) { return { h: fmt(T(lang).mau_h, { n: m[0][0] }), lines: [T(lang).mau_gone] }; }
};
