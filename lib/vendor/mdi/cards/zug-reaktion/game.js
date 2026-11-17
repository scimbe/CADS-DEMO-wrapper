// zug-reaktion "Wer zuckt zuerst?" – Altregel turns.js:784-796 (GAMES.reaktion): fuenf Runden, Koeder und Pausen aus dem Seed,
// fuer beide gleich; schneller gewinnt. Gemessen auf dem Geraet (Millisekunden).
import { T, fmt, mix, num } from "../../engines/zug-z2/lib.js";

function secs(ms, lang) { return num(ms / 1000, 2, lang); }
export function reactPlan(doc) { return [0, 1, 2, 3, 4].map((r) => ({ decoys: mix(doc, "lock" + r, 3)[0], pause: 700 + mix(doc, "pause" + r, 12)[0] * 150 })); }
export default {
  turns: [[{ w: "react", l: "rea_go", auto: true, plan: reactPlan }],
    [{ w: "react", l: "rea_go", auto: true, plan: reactPlan, peek: (doc, m, now, lang) => fmt(T(lang).rea_beat, { n: secs(m[0][0], lang) }) }]],
  result(doc, m, lang) {
    const X = T(lang), a = m[0][0], b = m[1][0];
    return { h: a === b ? X.rea_tie : fmt(X.rea_win, { w: a < b ? X.first : X.second }), lines: [X.first + ": " + secs(a, lang) + " s", X.second + ": " + secs(b, lang) + " s", a < b ? X.rea_tease : X.rea_tease2] };
  }
};
