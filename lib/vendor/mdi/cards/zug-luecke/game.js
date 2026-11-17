// zug-luecke "Füll die Lücke blind" – Altregel turns.js:185-194 (GAMES.luecke): eine Geschichte waehlen, der andere fuellt
// sechs Luecken blind, dann wird vorgelesen.
import { D, T, alt, side } from "../../engines/zug-z2/lib.js";

export default {
  turns: [
    [{ w: "pick", l: "luck_pick", n: 1, from: (doc, m, now, lang) => D.stories.map((s) => alt(s.split("||"), lang).split(" ").slice(0, 3).join(" ") + " ...") }],
    [{ w: "list", l: "luck_fill", n: 6, max: 18, hints: (lang) => side(D.hints[0], lang) }]
  ],
  result(doc, m, lang) {
    const s = alt(D.stories[m[0][0][0]].split("||"), lang), w = m[1][0];
    return { h: T(lang).luck_h, lines: [s.replace(/\{(\d)\}/g, (x, i) => w[i])] };
  }
};
