// zug-socken "Wo sind meine Socken?" – Altregel turns.js:646-668 (GAMES.socken): jede Seite versteckt zwei Socken auf 5×5;
// je Zug sechs Tipps auf das andere Feld: gefunden, nah oder fern. Gewonnen erst nach gleich vielen Suchrunden.
import { T, fmt } from "../../engines/zug-z2/lib.js";
import { base, ints } from "../../engines/zug-z2/views.js";


function hidden(m, who) { return m[who][0]; }
export function sockAnswer(socks, c) { const x = c % 5, y = Math.floor(c / 5); return socks.indexOf(c) >= 0 ? 2 : socks.some((s) => Math.max(Math.abs(s % 5 - x), Math.abs(Math.floor(s / 5) - y)) <= 1) ? 1 : 0; }
function sockFound(m, who) {
  const mine = hidden(m, who), got = {};
  m.forEach((t, i) => { if (i < 1 || i % 2 === who) return; const taps = t[t.length - 1]; if (Array.isArray(taps)) taps.forEach((c) => { if (mine.indexOf(c) >= 0) got[c] = 1; }); });
  return Object.keys(got).length;
}
export function sockTaps(m, who) { let o = []; m.forEach((t, i) => { if (i >= 1 && i % 2 !== who) o = o.concat(t[t.length - 1]); }); return o; }
function sockTurn(t) {
  const p = { w: "probe", l: "sok_probe", n: 6, socks: (doc, m) => hidden(m, (t + 1) % 2), before: (doc, m) => sockTaps(m, (t + 1) % 2) };
  return t === 1 ? [{ w: "grid", l: "sok_hide", n: 2 }, p] : [p];
}
export default {
  // Widget probe (ADR 0001): jede Zelle kennt ihre Antwort schon (die Socken stehen ohnehin im Link, alt ebenso)
  view: {
    probe(p, c) {
      const socks = p.socks(c.doc, c.m);
      return base(p, c, { rows: 5, cols: 5, n: p.n, answers: ints(25).map((k) => sockAnswer(socks, k)), before: p.before(c.doc, c.m), legend: c.X.sok_key });
    }  },
  turns: [[{ w: "grid", l: "sok_hide", n: 2 }]].concat([1, 2, 3, 4, 5, 6].map(sockTurn)),
  ends: (doc, m) => m.length >= 3 && m.length % 2 === 1 && (sockFound(m, 0) === 2 || sockFound(m, 1) === 2),
  result(doc, m, lang) {
    const X = T(lang), a = sockFound(m, 1), b = sockFound(m, 0), w = a === b ? null : a > b ? X.first : X.second;
    return { h: w ? fmt(X.sok_win, { w }) : X.sok_tie, lines: [fmt(X.sok_score, { w: X.first, n: a }), fmt(X.sok_score, { w: X.second, n: b }), fmt(X.sok_turns, { n: m.length - 1 })] };
  }
};
