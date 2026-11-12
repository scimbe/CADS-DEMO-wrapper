// raum-streichen "Was machen wir jetzt?" – Altregel turns.js:822-832 (GAMES.streichen): sieben Vorschlaege, reihum streicht jede
// Person einen, der letzte bleibt. Ein Geraet.
import { D, T, fmt, side } from "../../engines/zug-z2/lib.js";

function offers(doc, lang) { return side(D.sets[doc.seed % D.sets.length], lang); }
function struck(doc, m, lang) { const left = offers(doc, lang).map((x, i) => i); m.forEach((t) => { left.splice(t[0][0], 1); }); return left; }
function strike() { return [{ w: "pick", l: "str_pick", n: 1, auto: true, from: (doc, m, now, lang) => { const o = offers(doc, lang); return struck(doc, m, lang).map((i) => o[i]); } }]; }
export default {
  local: true, turns: [strike(), strike(), strike(), strike(), strike(), strike()],
  result(doc, m, lang) { const X = T(lang); return { h: fmt(X.str_h, { o: offers(doc, lang)[struck(doc, m, lang)[0]] }), lines: [X.str_note] }; }
};
