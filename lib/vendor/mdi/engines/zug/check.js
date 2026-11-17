// Antwortpruefung je Prompt-Art, 1:1 aus turns.js:1159-1194 (okAnswer). Ein Link laesst sich von Hand bauen: jede
// Antwort muss eine sein, die der Bildschirm haette geben koennen. Kartenspezifische Pruefungen kommen als p.check
// (wie turnzwei/feier) oder als Haken am Prompt (p.ok, p.bad, p.before, p.replay).
import { clean, fold, intIn, distinct } from "./alt.js";
import { shopOk } from "./merge.js";

const utf8len = (s) => new TextEncoder().encode(s).length;

export function okAnswer(p, v, doc, lang, m, now) {
  m = m || []; now = now || [];
  if (p.bytes && Array.isArray(v) && utf8len(v.join("")) > p.bytes) return false;
  if (p.check) return !!p.check(v, doc, m, now);
  switch (p.w) {
    case "show": case "touch": case "clock": case "blow": return v === 0;
    case "hunt": return intIn(v, 1, p.max);
    case "drop": return intIn(v, 0, p.max);
    case "doors": return v === 0;
    case "freeze": return intIn(v, 0, p.max);
    case "rec": case "once": case "parrot": case "pay": return v === 0;
    case "slots": case "vote": case "bw": return !!p.ok(v, m);
    case "shop": case "wish": return shopOk(v, p.cfg);
    case "opts": return Array.isArray(v) && v.length === p.n && distinct(v) && v.every((x) => intIn(x, 0, p.keys.length - 1));
    case "whose": return intIn(v, 0, 2);
    case "inner": return Array.isArray(v) && v.length === 5 && v.every((x) => Number.isInteger(x) && x >= -20000 && x <= 20000);
    case "blind": return intIn(v, 2000, 30000);
    case "nim": return v === 0 || v === 1;
    case "react": return intIn(v, 0, 60000);
    case "door": return Array.isArray(v) && v.length === 3 && intIn(v[0], 0, 10) && intIn(v[2], 0, 999) && intIn(v[1], 0, v[2]);
    case "voices": return intIn(v, 0, p.rounds);
    case "grid": return Array.isArray(v) && v.length === p.n && distinct(v) && v.every((x) => intIn(x, 0, 24));
    case "probe": { const old = p.before(doc, m); return Array.isArray(v) && v.length >= 1 && v.length <= p.n && distinct(v.concat(old)) && v.every((x) => intIn(x, 0, 24)); }
    case "explain": return intIn(v, 0, p.max);
    case "blocks": return Array.isArray(v) && v.length <= p.max && v.every((x) => intIn(x, 0, 63)) && !!(p.replay && p.replay(doc, v));
    case "slide": return intIn(v, p.min || 0, p.maxOf ? p.maxOf(doc) : p.max);
    case "money": return Number.isInteger(v) && !!p.ok(v, now);
    case "text": return typeof v === "string" && !!clean(v, p.max) && clean(v, p.max) === v && !(p.oneWord && /\s/.test(v)) && !(p.bad && p.bad(v, doc, lang, m));
    case "list":
      if (p.loose) return Array.isArray(v) && v.length === p.n && (!p.least || (v.filter(Boolean).length >= p.least && distinct(v.filter(Boolean).map(fold)))) && v.every((x) => x === "" || (typeof x === "string" && clean(x, p.max) === x));
      return Array.isArray(v) && v.length === p.n && v.every((x) => typeof x === "string" && !!clean(x, p.max) && clean(x, p.max) === x) && (p.same || distinct(v.map(fold)));
    default: break;
  }
  const n = p.from ? p.from(doc, m, now, lang).length : 0;
  switch (p.w) {
    case "ideas": return Array.isArray(v) && v.length === 2 && Array.isArray(v[0]) && v[0].length >= 1 && v[0].length <= 5 && distinct(v[0].map(fold)) && v[0].every((x) => typeof x === "string" && !!clean(x, 40) && clean(x, 40) === x) && intIn(v[1], 0, v[0].length - 1);
    case "day": return intIn(v, 20000, 30000);
    case "pick": return Array.isArray(v) && v.length === p.n && distinct(v) && v.every((x) => intIn(x, 0, n - 1));
    case "rank": return Array.isArray(v) && v.length === n && distinct(v) && v.every((x) => intIn(x, 0, n - 1));
    case "alloc": return Array.isArray(v) && v.length === n && v.every((x) => intIn(x, 0, p.sum) && x % p.step === 0) && v.reduce((a, b) => a + b, 0) <= p.sum;
    default: return false;
  }
}
