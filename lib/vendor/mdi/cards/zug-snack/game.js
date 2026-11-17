// zug-snack "Pizza oder Pommes?" – Altregel turns.js:142-148, 156-162 (GAMES.snack): zehn Entweder-oder, wie gleich tickt ihr.
import { D, T, fmt, pair, mix } from "../../engines/zug-z2/lib.js";

function eithers(doc) { return mix(doc, "either", D.either.length).slice(0, 10); }
function tens() {
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ w: "pick", n: 1, auto: true, l: "snack_q", from: (doc, m, now, lang) => pair(D.either, eithers(doc)[i], lang).split(lang === "en" ? " or " : " oder ") }));
}
function score(a, b) { let n = 0; a.forEach((x, i) => { if (x[0] === b[i][0]) n++; }); return n; }
export default {
  turns: [tens(), tens()],
  result(doc, m, lang) {
    const X = T(lang), n = score(m[0], m[1]), e = eithers(doc), diff = e.filter((x, i) => m[0][i][0] !== m[1][i][0]).slice(0, 2);
    return { h: fmt(X.snack_h, { n }), lines: [n >= 7 ? X.snack_top : X.snack_low].concat(diff.map((i) => fmt(X.snack_fight, { o: pair(D.either, i, lang) }))) };
  }
};
