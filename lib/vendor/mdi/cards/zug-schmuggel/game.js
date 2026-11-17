// zug-schmuggel "Schmuggel das Wort" – Altregel turns.js:26-29, 80-90 (GAMES.schmuggel): je drei Woerter in den Chat
// schmuggeln, der andere findet sie im Feld aus zwoelf.
import { D, T, fmt, pair, mix, hits } from "../../engines/zug-z2/lib.js";

function smuggle(doc) { return mix(doc, "schmuggel", D.smuggle.length).slice(0, 12); }
function smugglePick(doc, who) { const s = smuggle(doc); return who ? s.slice(3, 6) : s.slice(0, 3); }
function smuggleBoard(doc, lang) { const s = smuggle(doc); return mix(doc, "board", 12).map((i) => pair(D.smuggle, s[i], lang)); }
function smuggleSpot(doc, who) { const s = smuggle(doc), o = mix(doc, "board", 12), mine = smugglePick(doc, who); return o.map((i, at) => (mine.indexOf(s[i]) >= 0 ? at : -1)).filter((x) => x >= 0); }
const mineOf = (who) => (doc, m, now, lang) => smugglePick(doc, who).map((i) => pair(D.smuggle, i, lang));
const guess = () => ({ w: "pick", l: "smug_guess", n: 3, from: (doc, m, now, lang) => smuggleBoard(doc, lang) });
export default {
  turns: [
    [{ w: "show", l: "smug_mine", list: mineOf(0) }],
    [{ w: "show", l: "smug_mine", list: mineOf(1), later: "smug_later" }, guess()],
    [guess()]
  ],
  result(doc, m, lang) {
    const X = T(lang), b = hits(m[1][1], smuggleSpot(doc, 0)).length, a = hits(m[2][0], smuggleSpot(doc, 1)).length;
    return { h: a === b ? X.smug_tie : X.smug_win, lines: [fmt(X.smug_score, { w: X.first, n: b }), fmt(X.smug_score, { w: X.second, n: a })] };
  }
};
