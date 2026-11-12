// raum-papagei "Rückwärts-Papagei" – Altregel turns.js:727-733 (GAMES.papagei): ein Wort rueckwaerts sprechen, aufnehmen; die
// naechste Person hoert es rueckwaerts, spricht nach, die Aufnahme wird wieder umgedreht; dann wird geraten.
import { D, T, fmt, pair, mix } from "../../engines/zug-z2/lib.js";

export function parrotWords(doc, lang) { return mix(doc, "papagei", D.words.length).slice(0, 3).map((i) => pair(D.words, i, lang)); }
export default {
  local: true,
  turns: [[{ w: "show", l: "pap_say", list: (doc, m, now, lang) => [parrotWords(doc, lang)[mix(doc, "pw", 3)[0]]] }, { w: "rec", l: "pap_rec", auto: true, ms: 2500, slot: "pap_a" }],
    [{ w: "parrot", l: "pap_copy", auto: true, from: "pap_a", slot: "pap_b" }, { w: "pick", l: "pap_guess", n: 1, auto: true, from: (doc, m, now, lang) => parrotWords(doc, lang) }]],
  result(doc, m, lang) { const X = T(lang), w = parrotWords(doc, lang), ok = mix(doc, "pw", 3)[0]; return { h: m[1][1][0] === ok ? X.pap_right : X.pap_wrong, lines: [fmt(X.pap_was, { w: w[ok] })] }; }
};
