// zug-kennst "Kennst du mich wirklich?" – Altregel turns.js:134-141, 147-155 (GAMES.kennst): je 5 Fragen ueber sich, der andere raet.
import { D, T, fmt, alt, mix } from "../../engines/zug-z2/lib.js";

function side(s, lang) { return alt(s.split("||"), lang).split("|"); }
function asks(doc) { return mix(doc, "frag", D.ask.length).slice(0, 5); }
function askText(doc, i, lang) { return side(D.ask[asks(doc)[i]], lang); }
function fives(key) {
  return [0, 1, 2, 3, 4].map((i) => ({
    w: "pick", n: 1, auto: true, l: key,
    top: (doc, m, lang) => fmt(T(lang)[key], { q: askText(doc, i, lang)[0] }),
    from: (doc, m, now, lang) => askText(doc, i, lang).slice(1)
  }));
}
function score(a, b) { let n = 0; a.forEach((x, i) => { if (x[0] === b[i][0]) n++; }); return n; }
export default {
  turns: [fives("ken_self"), fives("ken_guess").concat(fives("ken_self")), fives("ken_guess")],
  result(doc, m, lang) {
    const X = T(lang), a = score(m[0], m[1].slice(0, 5)), b = score(m[1].slice(5), m[2]);
    return { h: a + b >= 7 ? X.ken_top : fmt(X.ken_head, { a, b }), lines: [fmt(X.ken_head, { a, b })] };
  }
};
