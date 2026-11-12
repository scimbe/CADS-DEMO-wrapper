// zug-rap "Battle-Rap Zug um Zug" – Altregel turns.js:674-698 (GAMES.rap): je zwei Reimkarten aus der eigenen Familie; Punkte
// gibt es fuer Karten der Art 2 (Pointe).
import { D, T, fmt, mix } from "../../engines/zug-z2/lib.js";

const RAPTYPE = [0, 0, 1, 1, 2, 2];
function rapFam(doc, who) { return mix(doc, "rap", D.rap.de.length)[who]; }
function rapLine(doc, who, i, lang) { return (D.rap[lang] || D.rap.de)[rapFam(doc, who)][i]; }
function rapCards(doc, who, k, avoid) { return mix(doc, "karte" + who + k, 6).filter((i) => i !== avoid).slice(0, 3); }
function rapChosen(doc, m, now) {
  const out = [];
  m.concat(now.length ? [now] : []).forEach((t, who) => {
    const first = rapCards(doc, who, 0)[t[0][0]]; out.push(first);
    if (t[1]) out.push(rapCards(doc, who, 1, first)[t[1][0]]);
  });
  return out;
}
function rapSoFar(doc, m, now, lang) { return rapChosen(doc, m, now).map((i, at) => rapLine(doc, at < 2 ? 0 : 1, i, lang)).join(" / "); }
function rapPick(who, k) {
  return {
    w: "pick", l: "rap_pick", n: 1, auto: true,
    peek: (doc, m, now, lang) => rapSoFar(doc, m, now, lang) || T(lang).rap_start,
    from: (doc, m, now, lang) => { const X = T(lang), avoid = k ? rapCards(doc, who, 0)[now[0][0]] : -1; return rapCards(doc, who, k, avoid).map((i) => X["rap_t" + RAPTYPE[i]] + ": " + rapLine(doc, who, i, lang)); }
  };
}
export default {
  turns: [[rapPick(0, 0), rapPick(0, 1)], [rapPick(1, 0), rapPick(1, 1)]],
  result(doc, m, lang) {
    const X = T(lang), c = rapChosen(doc, m, []), a = (RAPTYPE[c[0]] === 2) + (RAPTYPE[c[1]] === 2), b = (RAPTYPE[c[2]] === 2) + (RAPTYPE[c[3]] === 2);
    return { h: a === b ? fmt(X.rap_tie, { a }) : fmt(X.rap_win, { w: a > b ? X.first : X.second, a, b }), lines: c.map((i, at) => rapLine(doc, at < 2 ? 0 : 1, i, lang)) };
  }
};
