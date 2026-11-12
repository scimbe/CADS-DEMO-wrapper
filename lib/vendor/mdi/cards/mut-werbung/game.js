// mut-werbung "Verkauf deinen Stift" – Altregel turns.js:455-467 (GAMES.werbung): drei Namen, jede Person wirbt 30 Sekunden fuer
// eine Kundschaft aus dem Seed, dann stimmt jede fuer eine andere Person.
import { D, T, fmt, pair, mix } from "../../engines/zug-z2/lib.js";

function buyers(doc, lang) { return pair(D.buyers, mix(doc, "kunde", D.buyers.length)[0], lang); }
function sellTurn(i) { return [{ w: "clock", l: "wer_sell", secs: 30, auto: true, text: (doc, m, lang) => fmt(T(lang).wer_for, { n: m[0][0][i], b: buyers(doc, lang) }) }]; }
function buyTurn(i) { return [{ w: "pick", l: "wer_buy", n: 1, auto: true, peek: (doc, m, now, lang) => fmt(T(lang).ask_you, { n: m[0][0][i] }), from: (doc, m) => m[0][0].filter((x, at) => at !== i) }]; }
export default {
  local: true, turns: [[{ w: "list", l: "ask_names", n: 3, max: 12 }], sellTurn(0), sellTurn(1), sellTurn(2), buyTurn(0), buyTurn(1), buyTurn(2)],
  result(doc, m, lang) {
    const X = T(lang), names = m[0][0], c = [0, 0, 0];
    [0, 1, 2].forEach((v) => { const o = [0, 1, 2].filter((x) => x !== v); c[o[m[4 + v][0][0]]]++; });
    const top = Math.max(...c), best = names.filter((x, i) => c[i] === top);
    return { h: best.length === 1 ? fmt(X.wer_h, { n: best[0], c: top }) : X.wer_tie, lines: names.map((x, i) => x + ": " + c[i]) };
  }
};
