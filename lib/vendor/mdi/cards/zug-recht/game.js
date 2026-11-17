// zug-recht "Wer hat recht?" – Altregel turns.js:272-277 (GAMES.recht): zwei Seiten schreiben je ein Argument, im dritten Zug
// urteilt Seite 1 mit Begruendung aus fester Liste.
import { D, T, fmt, pair, listOf } from "../../engines/zug-z2/lib.js";

function fight(doc, lang) { return pair(D.fights, doc.seed % D.fights.length, lang); }
export default {
  turns: [[{ w: "text", l: "rec_a", max: 44 }], [{ w: "text", l: "rec_b", max: 44 }],
    [{ w: "pick", n: 1, l: "rec_who", top: (doc, m, lang) => fight(doc, lang) + " A: " + m[0][0] + " B: " + m[1][0], from: (doc, m, now, lang) => [T(lang).first, T(lang).second] }, { w: "pick", n: 1, l: "rec_why", from: listOf("verdicts") }]],
  result(doc, m, lang) { const X = T(lang); return { h: fmt(X.rec_h, { w: m[2][0][0] ? X.second : X.first }), lines: [fmt(X.rec_case, { f: fight(doc, lang) }), m[0][0], m[1][0], pair(D.verdicts, m[2][1][0], lang)] }; }
};
