// zug-wort "Ein Wort für drei" – Altregel turns.js:25, 70-79 (GAMES.wort): drei von neun Woertern waehlen, ein Hinweiswort, der andere raet.
import { D, T, fmt, fold, pair, mix, hits } from "../../engines/zug-z2/lib.js";

function board(doc, lang) { return mix(doc, "wort", D.words.length).slice(0, 9).map((i) => pair(D.words, i, lang)); }
export default {
  turns: [
    [{ w: "pick", l: "wort_pick", n: 3, from: (doc, m, now, lang) => board(doc, lang) },
      { w: "text", l: "wort_clue", max: 14, oneWord: true, bad: (v, doc, lang) => board(doc, lang).some((x) => fold(x) === fold(v)) }],
    [{ w: "pick", l: "wort_guess", n: 3, top: (doc, m) => m[0][1], from: (doc, m, now, lang) => board(doc, lang) }]
  ],
  result(doc, m, lang) {
    const X = T(lang), n = hits(m[0][0], m[1][0]).length, b = board(doc, lang);
    return { h: fmt(X["wort_" + n], { n }), lines: [fmt(X.wort_was, { c: m[0][1], w: m[0][0].map((i) => b[i]).join(", ") })] };
  }
};
