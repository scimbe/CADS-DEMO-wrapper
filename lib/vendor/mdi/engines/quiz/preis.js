// "Was kostet das?" (alt:src/quizspiele.js preis) und "Fünf mal schätzen" (alt:src/turns.js GAMES.schaetzen).
// Rein; jede Reihenfolge aus dem Seed, bitgleich zum Altcode (seed32).
import { seeded, mixIndex } from "../seed32/seed32.js";
import { floorLog10, pow10 } from "./pack.js";
import QS from "./quizspiele.json" with { type: "json" };
import SCH from "./schaetzen.json" with { type: "json" };

export const PREIS_N = 8, STEP = 5, PREIS_MAX = 999999;
export const FACTS = QS.preis;
function mix(seed, tag, n) { return mixIndex(seeded("qs|" + seed + "|" + tag), n); }

/** Die 8 von 12 Preisen dieser Partie (Index in quizspiele.json preis). */
export function preisItems(seed) { return mix(seed, "preis", FACTS.c.length).slice(0, PREIS_N); }
export function cents(k) { return FACTS.c[k]; }
/** Ende des Schiebers: der Preis liegt gleichverteilt zwischen 1/5 und 4/5, auf zwei Stellen und den Schritt aufgerundet. */
export function top(seed, i) {
  const z = cents(preisItems(seed)[i]), v = z / (0.2 + 0.6 * seeded("qs|" + seed + "|top" + i)());
  const p = Math.max(STEP, pow10(floorLog10(v) - 1));
  return Math.max(z + STEP, Math.ceil(v / p) * p);
}
/** Startwert des Schiebers (alt defOf): Mitte, auf den Schritt gerundet. */
export function start(seed, i) { return Math.round(top(seed, i) / 2 / STEP) * STEP; }
/** Mittlerer Abstand in Prozent (je Preis höchstens 100). */
export function off(seed, a) {
  return Math.round(preisItems(seed).reduce((s, k, i) => s + Math.min(100, Math.abs(a[i] - cents(k)) / cents(k) * 100), 0) / PREIS_N);
}
/** Immer mit Cent ("6,00 €" / "€6.00"), wie die Sprache es schreibt (wie Intl de-DE/en-GB, Tausender gruppiert),
 *  ohne Intl: die Harness erlaubt in Kartenlogik keine gebietsschema-abhängigen Funktionen. */
export function money(c, lang) {
  const neg = c < 0, a = Math.abs(Math.round(c)), eur = Math.floor(a / 100), ct = a % 100, en = lang === "en";
  const digits = String(eur), groups = [];
  for (let i = digits.length; i > 0; i -= 3) groups.unshift(digits.slice(Math.max(0, i - 3), i));
  const num = groups.join(en ? "," : ".") + (en ? "." : ",") + (ct < 10 ? "0" : "") + ct;
  return (neg ? "-" : "") + (en ? "€" + num : num + " €");
}
/** Texte der Beispiele je Sprache (Deutsch, wo eine Sprache nichts hat). */
export function items(lang) { return (QS[lang] || QS.de).preis; }

// ---------- Fünf mal schätzen (raum-schaetzen, Variante): heute für alle dieselben fünf Fragen ----------
export const GUESS = SCH.guess, GUESS_N = 5;
/** Seed wie alt turns.js mix ("turn|" + seed); die Tageskarte nimmt die Tagesnummer als Seed. */
export function guesses(seed) { return mixIndex(seeded("turn|" + seed + "|tag"), GUESS.length).slice(0, GUESS_N).map((i) => GUESS[i]); }
/** Abstand je Frage in Prozent (höchstens 100) und Mittel. */
export function guessOff(seed, a) {
  const g = guesses(seed), offs = g.map((q, i) => Math.min(100, Math.round(Math.abs(a[i] - q[2]) / q[2] * 100)));
  return { offs, mean: Math.round(offs.reduce((x, y) => x + y, 0) / GUESS_N) };
}
