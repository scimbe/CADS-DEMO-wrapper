// zug-luege "Eins davon ist gelogen" – Altregel turns.js:255-260 (GAMES.luege): drei Saetze, einer gelogen, der andere raet.
import { T, fmt } from "../../engines/zug-z2/lib.js";

function three(m) { return m[0][0]; }
export default {
  turns: [
    [{ w: "list", l: "lie_write", n: 3, max: 44 }, { w: "pick", n: 1, l: "lie_which", from: (doc, m, now) => now[0] }],
    [{ w: "pick", n: 1, l: "lie_guess", from: (doc, m) => three(m) }]
  ],
  result(doc, m, lang) { const X = T(lang), at = m[0][1][0]; return { h: m[1][0][0] === at ? X.lie_ok : X.lie_no, lines: [fmt(X.lie_was, { s: three(m)[at] })] }; }
};
