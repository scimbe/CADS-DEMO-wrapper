// zug-lob "Was ich an dir sehe" – Altregel turns.js:32, 91-104 (GAMES.lob): je drei Lobwoerter fuer sich und fuer den anderen.
import { D, T, fmt, pair, hits } from "../../engines/zug-z2/lib.js";

function praise(doc, lang) { return D.praise.map((x, i) => pair(D.praise, i, lang)); }
const both = () => [
  { w: "pick", l: "lob_me", n: 3, from: (doc, m, now, lang) => praise(doc, lang) },
  { w: "pick", l: "lob_you", n: 3, from: (doc, m, now, lang) => praise(doc, lang) }
];
export default {
  turns: [both(), both()],
  result(doc, m, lang) {
    const X = T(lang), p = praise(doc, lang), names = (l) => l.map((i) => p[i]).join(", ");
    const a = hits(m[0][0], m[1][1]), b = hits(m[1][0], m[0][1]);
    const sa = m[1][1].filter((i) => a.indexOf(i) < 0), sb = m[0][1].filter((i) => b.indexOf(i) < 0), out = [];
    if (a.length + b.length) out.push(fmt(X.lob_same, { w: names(a.concat(b)) }));
    if (sa.length) out.push(fmt(X.lob_sees, { n: X.first, w: names(sa) }));
    if (sb.length) out.push(fmt(X.lob_sees, { n: X.second, w: names(sb) }));
    return { h: X.lob_head, lines: out };
  }
};
