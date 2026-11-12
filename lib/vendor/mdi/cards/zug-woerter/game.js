// zug-woerter "Wörterbuch für zwei" – Altregel turns.js:390-416 (GAMES.woerter): ein Fantasiewort einem Moment zuordnen, der
// andere raet den Moment; vier Runden abwechselnd.
import { D, T, fmt, pair, mix } from "../../engines/zug-z2/lib.js";

function coinSlot(doc, r) { return mix(doc, "wort5", D.coined.length).slice(r * 5, r * 5 + 5); }
function momentSlot(doc, r) { return mix(doc, "moment", D.moments.length).slice(r * 6, r * 6 + 6); }
function coinPrompts(r) {
  return [
    { w: "pick", l: "wbu_word", n: 1, auto: true, from: (doc) => coinSlot(doc, r).map((i) => D.coined[i]) },
    { w: "pick", l: "wbu_moment", n: 1, auto: true, from: (doc, m, now, lang) => momentSlot(doc, r).map((i) => pair(D.moments, i, lang)) }
  ];
}
function coinWord(doc, m, r) { const a = m[r], off = r ? 1 : 0; return coinSlot(doc, r)[a[off][0]]; }
function coinMoment(doc, m, r) { const a = m[r], off = r ? 1 : 0; return momentSlot(doc, r)[a[off + 1][0]]; }
function coinOptions(doc, m, r) {
  const s = momentSlot(doc, r), at = s.indexOf(coinMoment(doc, m, r)), o = [s[at], s[(at + 1) % 6], s[(at + 2) % 6]], k = mix(doc, "wahl" + r, 3);
  return k.map((i) => o[i]);
}
function coinGuess(r) {
  return { w: "pick", l: "wbu_guess", n: 1, auto: true, top: (doc, m) => D.coined[coinWord(doc, m, r)], from: (doc, m, now, lang) => coinOptions(doc, m, r).map((i) => pair(D.moments, i, lang)) };
}
export default {
  turns: [coinPrompts(0), [coinGuess(0)].concat(coinPrompts(1)), [coinGuess(1)].concat(coinPrompts(2)), [coinGuess(2)].concat(coinPrompts(3)), [coinGuess(3)]],
  result(doc, m, lang) {
    const X = T(lang);
    let hit = 0;
    const lines = [0, 1, 2, 3].map((r) => {
      if (coinOptions(doc, m, r)[m[r + 1][0][0]] === coinMoment(doc, m, r)) hit++;
      return fmt(X.wbu_line, { w: D.coined[coinWord(doc, m, r)], m: pair(D.moments, coinMoment(doc, m, r), lang) });
    });
    return { h: fmt(X.wbu_h, { n: hit }), lines };
  }
};
