// zug-auktion "Auktion im Dunkeln" mit den eingeklappten Varianten zug-deal, zug-teilen, zug-socke, zug-fallpreis
// (ideas.json Feld to). Altregeln: auktion turns.js:30-31, 105-119, deal :36-53, 1111-1114, teilen :163-174, socke :195-201, fallpreis :629-645.
import { D, T, fmt, pair, mix, clean } from "../../engines/zug-z2/lib.js";

function lots(doc, lang) { return mix(doc, "items", D.items.length).slice(0, 5).map((i) => pair(D.items, i, lang)); }
function worth(doc, who) { return mix(doc, "wert" + who, 5).map((i) => (i + 1) * 10); }
export const auktion = {
  turns: [
    [{ w: "alloc", l: "auk_bid", sum: 100, step: 10, from: (doc, m, now, lang) => lots(doc, lang), vals: (doc) => worth(doc, 0) }],
    [{ w: "alloc", l: "auk_bid", sum: 100, step: 10, from: (doc, m, now, lang) => lots(doc, lang), vals: (doc) => worth(doc, 1) }]
  ],
  result(doc, m, lang) {
    const X = T(lang), l = lots(doc, lang), wa = worth(doc, 0), wb = worth(doc, 1), lines = [];
    let sa = 0, sb = 0;
    l.forEach((x, i) => {
      const a = m[0][0][i], b = m[1][0][i], who = a === b ? null : a > b ? 0 : 1;
      if (who === 0) sa += wa[i]; if (who === 1) sb += wb[i];
      lines.push(x + ": " + (who === null ? X.auk_none : who === 0 ? X.first : X.second));
    });
    return { h: fmt(sa === sb ? X.auk_tie : X.auk_win, { w: sa > sb ? X.first : X.second, a: sa, b: sb }), lines };
  }
};

// Zehn Kekse, ein Angebot: zwei Ultimatum-Runden; doc.w ersetzt "Kekse" (Altfeld w, Q.clean 14)
function things(doc, lang) { return doc.w || T(lang).things; }
function splitLine(x, y, f) { return x >= f ? { a: 10 - x, b: x } : null; }
function dealLine(doc, offer, floor, i, lang) {
  const X = T(lang), w = things(doc, lang);
  return fmt(offer >= floor ? X.deal_ok : X.deal_no, { w, o: 10 - offer, f: offer, m: floor, who: i ? X.second : X.first });
}
export const deal = {
  turns: [
    [{ w: "slide", l: "deal_offer", max: 10 }],
    [{ w: "slide", l: "deal_floor", max: 10 }, { w: "slide", l: "deal_offer2", max: 10, peek: (doc, m, now, lang) => dealLine(doc, m[0][0], now[0], 0, lang) }],
    [{ w: "slide", l: "deal_floor", max: 10 }]
  ],
  result(doc, m, lang) {
    const X = T(lang), one = splitLine(m[0][0], 0, m[1][0]), two = splitLine(m[1][1], 0, m[2][0]);
    return { h: one && two ? X.deal_both : X.deal_broke, lines: [dealLine(doc, m[0][0], m[1][0], 0, lang), dealLine(doc, m[1][1], m[2][0], 1, lang)] };
  }
};
export function cleanW(v) { return clean(v, 14); }

function tasks(doc, m, now, lang) { return D.tasks.map((x, i) => pair(D.tasks, i, lang)); }
export const teilen = {
  turns: [[{ w: "alloc", l: "teil_bid", sum: 10, step: 1, from: tasks }], [{ w: "alloc", l: "teil_bid", sum: 10, step: 1, from: tasks }]],
  result(doc, m, lang) {
    const X = T(lang), a = [], b = [], l = tasks(doc, m, [], lang), tie = mix(doc, "teil", 4);
    l.forEach((x, i) => { const d = m[0][0][i] - m[1][0][i], first = d > 0 || (d === 0 && tie[i] % 2 === 0); (first ? a : b).push(x); });
    return { h: X.teil_h, lines: [fmt(X.teil_a, { w: a.join(", ") || "-" }), fmt(X.teil_b, { w: b.join(", ") || "-" })] };
  }
};

export const socke = {
  turns: [[{ w: "slide", l: "soc_limit", min: 10, max: 200, def: 50 }], [{ w: "slide", l: "soc_bid", min: 10, max: 200, def: 50 }]],
  result(doc, m, lang) {
    const X = T(lang), a = m[0][0], b = m[1][0];
    return { h: fmt(X.soc_h, { n: a + b }), lines: [a === b ? X.soc_tie : fmt(X.soc_win, { w: a > b ? X.first : X.second })] };
  }
};

function junk(doc, lang) { return mix(doc, "quatsch", D.items.length).slice(0, 4).map((i) => pair(D.items, i, lang)); }
function junkWorth(doc, who) { return mix(doc, "qwert" + who, 9).slice(0, 4).map((i) => 20 + i * 10); }
function dropTurn(who) { return [0, 1, 2, 3].map((i) => ({ w: "drop", l: "aq_tap", auto: true, max: 100, item: (doc, lang) => junk(doc, lang)[i], worth: (doc) => junkWorth(doc, who)[i] })); }
export const fallpreis = {
  turns: [dropTurn(0), dropTurn(1)],
  result(doc, m, lang) {
    const X = T(lang), l = junk(doc, lang), wa = junkWorth(doc, 0), wb = junkWorth(doc, 1);
    let sa = 0, sb = 0;
    const lines = l.map((x, i) => {
      const a = m[0][i], b = m[1][i];
      if (a === b) return fmt(X.aq_none, { o: x, p: a });
      if (a > b) { sa += wa[i] - a; return fmt(X.aq_buy, { o: x, w: X.first, p: a, v: wa[i] }); }
      sb += wb[i] - b; return fmt(X.aq_buy, { o: x, w: X.second, p: b, v: wb[i] });
    });
    return { h: sa === sb ? fmt(X.aq_tie, { a: sa }) : fmt(X.aq_win, { w: sa > sb ? X.first : X.second, a: sa, b: sb }), lines };
  }
};
export const GAMES = { auktion, deal, teilen, socke, fallpreis };
export default auktion;
