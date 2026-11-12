// zug-hoeflich "Bloß nicht frech werden" – Altregel turns.js:374-389 (GAMES.hoeflich): abwechselnd Saetze mit 1–3 Frechheitspunkten,
// wer die geheime Grenze (7–16 aus dem Seed) ueberschreitet, verliert.
import { D, T, fmt, pk, mix } from "../../engines/zug-z2/lib.js";

function politeLimit(doc) { return 7 + mix(doc, "grenze", 10)[0]; }
function politeRow(doc, t) { return [0, 1, 2].map((s) => { const l = D.polite[s]; return l[mix(doc, "hof" + s, l.length)[t % l.length]]; }); }
function politeLevel(m) { return m.reduce((a, x) => a + x[0][0] + 1, 0); }
function politeTurn(t) {
  return [{ w: "pick", l: "hof_pick", n: 1, auto: true, peek: (doc, m, now, lang) => fmt(T(lang).hof_level, { n: politeLevel(m) }), from: (doc, m, now, lang) => politeRow(doc, t).map((x, s) => "•••".slice(0, s + 1) + " " + x.split("|")[lang === "en" ? 1 : 0]) }];
}
export default {
  turns: [0, 1, 2, 3, 4, 5].map(politeTurn),
  ends: (doc, m) => politeLevel(m) > politeLimit(doc),
  result(doc, m, lang) {
    const X = T(lang), at = m.length - 1, burst = politeLevel(m) > politeLimit(doc), last = pk(politeRow(doc, at)[m[at][0][0]], lang);
    let a = 0, b = 0;
    m.forEach((x, i) => { if (i % 2) b += x[0][0] + 1; else a += x[0][0] + 1; });
    if (burst) return { h: fmt(X.hof_burst, { w: at % 2 ? X.first : X.second }), lines: [fmt(X.hof_line, { l: last }), fmt(X.hof_limit, { n: politeLimit(doc) })] };
    return { h: a === b ? X.hof_tie : fmt(X.hof_win, { w: a > b ? X.first : X.second, a, b }), lines: [fmt(X.hof_limit, { n: politeLimit(doc) })] };
  }
};
