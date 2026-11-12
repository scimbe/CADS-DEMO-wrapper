// zug-blitz "Sechs Wörter, eine Minute" – Altregel turns.js:261-271 (GAMES.blitz): Anfangsbuchstabe aus dem Seed, sechs
// Kategorien; zaehlt nur, was passt und der andere nicht hat.
import { D, T, fmt, fold, side } from "../../engines/zug-z2/lib.js";

function letter(doc) { return D.letters[doc.seed % D.letters.length]; }
function blitzHint(lang) { return side(D.cats[0], lang); }
function blitzBox() {
  return { w: "list", l: "blz_go", n: 6, max: 16, loose: true, title: (doc, lang) => fmt(T(lang).blz_go, { l: letter(doc) }), hints: blitzHint, keep: (x, doc) => fold(x).charAt(0) === letter(doc).toLowerCase() };
}
export default {
  turns: [[blitzBox()], [blitzBox()]],
  result(doc, m, lang) {
    const X = T(lang), a = m[0][0].map(fold), b = m[1][0].map(fold);
    const good = (l, o) => l.filter((x) => x && o.indexOf(x) < 0 && x.charAt(0) === letter(doc).toLowerCase()).length;
    const same = m[0][0].filter((x) => x && b.indexOf(fold(x)) >= 0);
    return { h: fmt(X.blz_h, { a: good(a, b), b: good(b, a) }), lines: [fmt(X.blz_go, { l: letter(doc) })].concat(same.length ? [fmt(X.blz_same, { w: same.join(", ") })] : []) };
  }
};
