// karte-regel "Neue Regel für alle" – Altregel turns.js:437-454 (GAMES.regel): ein Satz aus vier Woertern aus festen Kaesten,
// jeder Zug tauscht ein Wort; so kommen keine Namen und nichts Gemeines hinein.
import { D, T, fmt, pair, mix } from "../../engines/zug-z2/lib.js";

function ruleStart(doc) { return D.rule.map((l, s) => mix(doc, "regel" + s, l.length)[0]); }
function ruleOthers(cur, s) { return D.rule[s].map((x, i) => i).filter((i) => i !== cur[s]); }
function ruleAt(doc, m) { const c = ruleStart(doc); m.forEach((x) => { c[x[0][0]] = ruleOthers(c, x[0][0])[x[1][0]]; }); return c; }
function ruleText(c, lang) { return c.map((w, s) => pair(D.rule[s], w, lang)).join(" ") + "."; }
function ruleTurn() {
  return [
    { w: "pick", l: "reg_slot", n: 1, auto: true, peek: (doc, m, now, lang) => ruleText(ruleAt(doc, m), lang), from: (doc, m, now, lang) => ruleAt(doc, m).map((w, s) => pair(D.rule[s], w, lang)) },
    { w: "pick", l: "reg_word", n: 1, auto: true, from: (doc, m, now, lang) => { const s = now[0][0]; return ruleOthers(ruleAt(doc, m), s).map((i) => pair(D.rule[s], i, lang)); } }
  ];
}
export default {
  turns: [ruleTurn(), ruleTurn(), ruleTurn(), ruleTurn(), ruleTurn()],
  result(doc, m, lang) {
    const X = T(lang), old = [];
    for (let i = 0; i < m.length; i++) old.push(fmt(X.reg_old, { r: ruleText(ruleAt(doc, m.slice(0, i)), lang) }));
    return { h: fmt(X.reg_h, { r: ruleText(ruleAt(doc, m), lang) }), lines: old };
  }
};
