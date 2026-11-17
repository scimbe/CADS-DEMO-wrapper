// Geld einsammeln, ganzzahlig in Cent (Altregel turns.js:850-902). Die Karte baut nur einen PayPal.me-Link; das Geld
// beruehrt uns nie. Nur der oeffentliche PayPal.me-Name reist, und nur mit den Zeichen, die PayPal dort erlaubt.
// Der Betrag wird auf 1 bis 20 Personen verteilt: alle zahlen denselben ganzen Cent-Anteil, die uebrigen Cent
// (weniger als Personen) bleiben beim Sammler, und die Karte sagt das. EUR begrenzt den Anteil je Person; der
// Business-Flavor darf ihn beim Bauen anheben (flavor.json eur), ein Link kann das nie.
import { intIn, money, fmt } from "./alt.js";

export const PPME = /^[A-Za-z0-9]{1,20}$/;
export const PAYERS = 20;
export const EUR = Object.freeze([1, 50]);

export function payName(v) { return typeof v === "string" && PPME.test(v); }
/** c Cent auf k Personen: e je Person, r Rest beim Sammler. */
export function split(c, k) { const e = Math.floor(c / k); return { c, k, e, r: c - e * k }; }
export function moneyOk(c, k, eur = EUR) { return intIn(k, 1, PAYERS) && intIn(c, eur[0] * 100, eur[1] * 100 * k) && split(c, k).e >= 1; }
/** "37,50", "37.5", "37 €" -> 3750; alles andere -> null (turns.js:866). */
export function parseCents(s) {
  const m = String(s == null ? "" : s).trim().match(/^(\d{1,5})(?:[.,](\d{1,2}))?\s*(?:€|eur)?$/i);
  return m ? +m[1] * 100 + (m[2] ? +(m[2] + "0").slice(0, 2) : 0) : null;
}
/** Betrag fuer den paypal.me-Link ("9.37", ganzzahlig "9") oder als Geld in der Sprache ("9,37 €", "€9.37"). */
export function euros(c, lang) {
  if (lang !== "url") return money(c, lang);
  const e = Math.floor(c / 100), r = c % 100;
  return r ? e + "." + String(r).padStart(2, "0") : String(e);
}
/** Antworten von Zug 1: [Name, Zweck, Personen, Cent]. */
export function sam(m) { const a = m[0] || []; return { n: a[0], w: a[1], k: a[2], c: a[3] }; }
export function payLink(m, eur = EUR) {
  const x = sam(m);
  return payName(x.n) && moneyOk(x.c, x.k, eur) ? "https://paypal.me/" + x.n + "/" + euros(split(x.c, x.k).e, "url") + "EUR" : "";
}
export function moneyLine(X, c, k, lang, bare) {
  const p = split(c, k);
  let s = bare ? "" : fmt(X.sam_share, { e: euros(p.e, lang) });
  if (k > 1) s = fmt(X.sam_split, { t: euros(c, lang), k }) + (s ? " · " + s : "");
  return p.r ? s + " · " + fmt(X.sam_rest, { r: p.r }) : s;
}
export function payLine(X, m, lang) { const x = sam(m); return fmt(X.sam_line, { e: euros(split(x.c, x.k).e, lang), w: x.w, n: x.n }); }
export function payLines(X, m, lang) { const x = sam(m); return x.k > 1 || split(x.c, x.k).r ? [payLine(X, m, lang), moneyLine(X, x.c, x.k, lang, true)] : [payLine(X, m, lang)]; }
export function payShare(m, lang) { const x = sam(m); return euros(split(x.c, x.k).e, lang); }
