// Textfilter der Quiz-Karten: dieselbe Funktion wie Widget und accepts der anderen Karten (src/contract/text.js, ADR 0001 c;
// Port von alt core.js/kontakt.js/quest.js). Gegen den eigenen wörtlichen Port dieses Strangs verglichen: 798 Texte
// (alle Nachtpakete und Filterfälle), clean/fold/isClean ohne Abweichung – deshalb kein zweiter Filter mehr hier.
import { clean, fold, isClean } from "../../contract/text.js";

export { isClean };
/** alt:src/quest.js clean */
export const questClean = clean;
/** alt:src/quest.js fold */
export const questFold = fold;
/** alt:src/daily.js cleanInput: Steuerzeichen und <> raus, Leerraum zusammen, höchstens max Zeichen, dann der Wortfilter. */
export function cleanInput(s, max) {
  const t = Array.from(String(s === undefined || s === null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max || 90).join("").trim();
  return t && isClean(t) ? t : "";
}
