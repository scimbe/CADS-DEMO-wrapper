// raum-maschine "Einer von uns ist Maschine" – Altregel turns.js:142, 468-487 (GAMES.maschine): drei Personen beantworten sechs
// Entweder-oder; eine vierte Zeile baut die Maschine aus der Mehrheit (mit 1–2 Kippstellen aus dem Seed); alle suchen sie.
import { D, T, fmt, pair, mix } from "../../engines/zug-z2/lib.js";

function eithers(doc) { return mix(doc, "either", D.either.length).slice(0, 10); }
function askAt(doc, q, lang) { return pair(D.either, eithers(doc)[q], lang).split(lang === "en" ? " or " : " oder "); }
function machineRows(doc, m) {
  const flip = mix(doc, "aus", 6).slice(0, 1 + doc.seed % 2), rows = [1, 2, 3].map((t) => m[t].map((a) => a[0]));
  rows.push([0, 1, 2, 3, 4, 5].map((q) => { const one = rows[0][q] + rows[1][q] + rows[2][q], most = one >= 2 ? 1 : 0; return flip.indexOf(q) >= 0 ? 1 - most : most; }));
  return rows;
}
function machineSeen(doc) { return mix(doc, "reihe", 4); }
function rowText(doc, r, lang) { return r.map((a, q) => askAt(doc, q, lang)[a]).join(", "); }
function machineAsk(i) {
  return [0, 1, 2, 3, 4, 5].map((q) => ({ w: "pick", l: "mas_q", n: 1, auto: true, peek: (doc, m, now, lang) => fmt(T(lang).ask_you, { n: m[0][0][i] }), from: (doc, m, now, lang) => askAt(doc, q, lang) }));
}
function machineVote(i) {
  return [{ w: "pick", l: "mas_vote", n: 1, auto: true, peek: (doc, m, now, lang) => fmt(T(lang).ask_you, { n: m[0][0][i] }), from: (doc, m, now, lang) => { const r = machineRows(doc, m); return machineSeen(doc).map((at) => rowText(doc, r[at], lang)); } }];
}
export default {
  local: true, turns: [[{ w: "list", l: "ask_names", n: 3, max: 12 }], machineAsk(0), machineAsk(1), machineAsk(2), machineVote(0), machineVote(1), machineVote(2)],
  result(doc, m, lang) {
    const X = T(lang), r = machineRows(doc, m), seen = machineSeen(doc), at = seen.indexOf(3), found = m[0][0].filter((x, i) => m[4 + i][0][0] === at);
    return { h: fmt(X.mas_h, { n: 3 - found.length }), lines: [fmt(X.mas_was, { r: rowText(doc, r[3], lang) }), found.length ? fmt(X.mas_found, { n: found.join(", ") }) : X.mas_none] };
  }
};
