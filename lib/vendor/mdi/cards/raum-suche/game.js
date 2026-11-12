// raum-suche "Such-Zettel" – Altregel turns.js:488-505 (GAMES.suche): vier Woerter aus dem Seed auf Zettel schreiben und verstecken,
// je ein Hinweis; die Suchenden tippen das gefundene Wort, die Zeit bleibt.
import { D, T, fmt, pair, mix } from "../../engines/zug-z2/lib.js";

export function huntWords(doc, lang) { return mix(doc, "suche", D.words.length).slice(0, 4).map((i) => pair(D.words, i, lang)); }
export default {
  local: true,
  turns: [
    [{ w: "show", l: "suc_words", list: (doc, m, now, lang) => huntWords(doc, lang), later: "suc_later" }, { w: "list", l: "suc_hints", n: 4, max: 40 }],
    [{ w: "hunt", l: "suc_go", auto: true, max: 3600, list: (doc, m, lang) => huntWords(doc, lang).map((x, i) => ({ w: x, hint: m[0][1][i] })) }]
  ],
  result(doc, m, lang) { const X = T(lang); return { h: fmt(X.suc_h, { n: m[1][0] }), lines: [X.suc_note] }; }
};
