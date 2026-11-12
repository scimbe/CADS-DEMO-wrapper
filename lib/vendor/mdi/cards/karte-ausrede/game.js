// karte-ausrede "Die beste Ausrede" – Altregel turns.js:231-237 (GAMES.ausrede): Ausrede aus drei Raedern, der andere stempelt.
import { D, T, pair, mix } from "../../engines/zug-z2/lib.js";

function wheel(k, l) { return { w: "pick", n: 1, auto: true, l, from: (doc, m, now, lang) => mix(doc, k, D[k].length).slice(0, 4).map((i) => pair(D[k], i, lang)) }; }
function excuse(doc, m, lang) { return ["who", "what", "why"].map((k, i) => pair(D[k], mix(doc, k, D[k].length)[m[0][i][0]], lang)).join(" "); }
export default {
  turns: [[wheel("who", "aus_who"), wheel("what", "aus_what"), wheel("why", "aus_why")],
    [{ w: "pick", n: 1, auto: true, l: "aus_stamp", top: (doc, m, lang) => excuse(doc, m, lang), from: (doc, m, now, lang) => { const X = T(lang); return [X.aus_s0, X.aus_s1, X.aus_s2]; } }]],
  result(doc, m, lang) { const X = T(lang); return { h: [X.aus_s0, X.aus_s1, X.aus_s2][m[1][0][0]], lines: [excuse(doc, m, lang)] }; }
};
