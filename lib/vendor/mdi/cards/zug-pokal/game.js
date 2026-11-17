// zug-pokal "Der Pokal wandert" – Altregel turns.js:759-766 (GAMES.pokal): blind zehn Sekunden stoppen, drei Versuche; wer naeher
// liegt, behaelt den Pokal. Variante raum-uhr "Innere Uhr" turns.js:749-758 (GAMES.uhr): fuenf Zielzeiten aus dem Seed, allein.
// Gemessen wird auf dem Geraet; die Karte bekommt nur die Millisekunden.
import { T, fmt, mix, num } from "../../engines/zug-z2/lib.js";

function secs(ms, lang) { return num(ms / 1000, 2, lang); }
export const pokal = {
  turns: [[{ w: "blind", l: "pok_go", auto: true, tries: 3, goal: 10000 }],
    [{ w: "blind", l: "pok_go", auto: true, tries: 3, goal: 10000, peek: (doc, m, now, lang) => fmt(T(lang).pok_beat, { n: secs(m[0][0], lang) }) }]],
  result(doc, m, lang) {
    const X = T(lang), a = Math.abs(m[0][0] - 10000), b = Math.abs(m[1][0] - 10000);
    return { h: a === b ? X.pok_tie : fmt(X.pok_win, { w: a < b ? X.first : X.second }), lines: [X.first + ": " + secs(m[0][0], lang) + " s", X.second + ": " + secs(m[1][0], lang) + " s"] };
  }
};
export function uhrTargets(doc) { return [0, 1, 2, 3, 4].map((r) => 3000 + mix(doc, "uhr" + r, 6)[0] * 1000); }
export const uhr = {
  local: true, daily: true,
  turns: [[{ w: "inner", l: "uhr_go", auto: true, targets: uhrTargets }]],
  result(doc, m, lang) {
    const X = T(lang), d = m[0][0], mean = Math.round(d.reduce((a, b) => a + b, 0) / d.length / 100) / 10;
    const h = Math.abs(mean) < 0.1 ? X.uhr_spot : fmt(mean < 0 ? X.uhr_early : X.uhr_late, { n: num(Math.abs(mean), null, lang) });
    return { h, lines: d.map((x, i) => fmt(X.uhr_line, { i: i + 1, t: num(uhrTargets(doc)[i] / 1000, null, lang), n: (x > 0 ? "+" : "") + num(x / 1000, 1, lang) })) };
  }
};
export const GAMES = { pokal, uhr };
export default pokal;
