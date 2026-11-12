// Siegel einer freien Karte in den Parametern einer Zielkarte (Strang K): ki = { k:"karte", s, h, o? } und fr (Wurzel eines
// Remix). So reist das Siegel im v2-Link mit (wie bei flug/lauf, Strang L), der Empfaenger fragt das Status-Gate und die
// Karte zeigt "Mit KI erstellt". Die Parameter heissen in jedem Manifest gleich: ki (object|null, x-hidden) und fr
// (string|null, x-hidden). Bereinigt wird hier, nie geraten: was nicht passt, ist null.
const S = /^[A-Za-z0-9._~-]{8,200}$/, H = /^[A-Za-z0-9_-]{43}$/, C = /^[A-Za-z0-9_-]{22}$/;
/** ki einer freien Karte oder null */
export function sealKi(ki) {
  if (!ki || typeof ki !== "object" || ki.k !== "karte" || typeof ki.s !== "string" || !S.test(ki.s) || typeof ki.h !== "string" || !H.test(ki.h)) return null;
  return { k: "karte", s: ki.s, h: ki.h, ...(typeof ki.o === "string" && C.test(ki.o) ? { o: ki.o } : {}) };
}
export const sealFr = (fr) => (typeof fr === "string" && C.test(fr) ? fr : null);
/** Doc -> { ki, fr } fuer die Parameter (nur, wenn das Manifest die Felder hat) */
export function sealParams(doc, props) {
  const out = {};
  if (props && props.ki) out.ki = sealKi(doc && doc.ki);
  if (props && props.fr) out.fr = sealFr(doc && doc.fr);
  return out;
}
/** Parameter -> { ki?, fr? } fuer das Doc (toFree) */
export function sealDoc(params) {
  const ki = sealKi(params && params.ki), fr = sealFr(params && params.fr);
  return { ...(ki ? { ki } : {}), ...(fr ? { fr } : {}) };
}
export const BADGE = { de: "Mit KI erstellt", en: "Made with AI" };
/** Knoten "Mit KI erstellt" fuer eine Karte mit Siegel, sonst null */
export function badgeNode(params, lang) { return sealKi(params && params.ki) ? { t: "text", role: "small", text: BADGE[lang === "en" ? "en" : "de"] } : null; }
