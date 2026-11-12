// beat-disco "Musik aus. Alle Statue" – Altregel turns.js:699-706 (GAMES.disco): Beat waehlen, Musik laeuft, Stopp nach 4–12 s aus
// dem Seed, dazu eine Statue; gezaehlt werden die Runden. Ein Geraet, Ton aus dem Geraet.
import { D, T, fmt, pair, alt, mix } from "../../engines/zug-z2/lib.js";

export function statue(doc, r, lang) { return pair(D.statues, mix(doc, "statue", D.statues.length)[r % D.statues.length], lang); }
export function pauseAt(doc, r) { return 4 + mix(doc, "pause" + r, 9)[0]; }
export default {
  local: true,
  turns: [[{ w: "pick", l: "dis_beat", n: 1, auto: true, from: (doc, m, now, lang) => D.discoBeats.map((b) => alt(b, lang)) },
    { w: "freeze", l: "dis_go", auto: true, max: 99, beat: (i) => D.discoBeats[i][2], statue, pause: pauseAt }]],
  result(doc, m, lang) { return { h: fmt(T(lang).dis_h, { n: m[0][1] }), lines: [T(lang).dis_note] }; }
};
