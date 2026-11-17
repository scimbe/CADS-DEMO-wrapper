// mut-tierstory "Tier-Aufstellung" – Altregel turns.js:720, 734-748 (GAMES.tier): drei Personen nehmen je ein Tiergeraeusch auf, die
// Aufnahmen werden verzerrt in gemischter Reihenfolge abgespielt, alle raten wer. Aufnahmen bleiben im Speicher dieses Geraets.
import { T, fmt, mix } from "../../engines/zug-z2/lib.js";

export const FXS = ["chip", "monster", "robot", "echo"];
function animalTurn(i) { return [{ w: "rec", l: "tie_rec", auto: true, ms: 1200, slot: "tier" + i, peek: (doc, m, now, lang) => fmt(T(lang).ask_you, { n: m[0][0][i] }) }]; }
export function animalOrder(doc) { return mix(doc, "tierfolge", 3); }
function animalGuess(k) {
  return { w: "whose", l: "tie_who", auto: true, slot: (doc) => "tier" + animalOrder(doc)[k], fx: (doc) => FXS[doc.seed % 4], title: (doc, lang) => fmt(T(lang).tie_n, { n: k + 1 }), from: (doc, m) => m[0][0] };
}
export default {
  local: true,
  turns: [[{ w: "list", l: "ask_names", n: 3, max: 12 }], animalTurn(0), animalTurn(1), animalTurn(2), [animalGuess(0), animalGuess(1), animalGuess(2)]],
  result(doc, m, lang) {
    const X = T(lang), o = animalOrder(doc), names = m[0][0], hit = o.map((who, k) => m[4][k] === who);
    const lines = names.map((n, who) => fmt(hit[o.indexOf(who)] ? X.tie_known : X.tie_hidden, { n }));
    return { h: fmt(X.tie_h, { n: hit.filter(Boolean).length }), lines };
  }
};
