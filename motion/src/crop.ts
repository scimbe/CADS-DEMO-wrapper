// Bildausschnitt fuer Bildschirmaufnahmen: Die Vergroesserung ist fest, damit Text auch auf dem Handy
// lesbar bleibt. 16-px-Text ergibt bei 2.0 etwa 32 px im 1920er-Bild, bei 2.4 etwa 38 px im 1080er-Bild.
// Quelle sind in beiden Formaten die Handy-Aufnahmen (390 px breit, einspaltig), so wird nichts abgeschnitten.
// Der Ausschnitt legt sich um den Fokus; test/motion.test.mjs prueft, dass der Fokus hineinpasst.
export type R = {x: number; y: number; w: number; h: number};
export type Size = {w: number; h: number};
export const BOX: Record<'H' | 'V', Size> = {H: {w: 800, h: 820}, V: {w: 960, h: 1120}};
export const MIN_SCALE: Record<'H' | 'V', number> = {H: 2, V: 2.4};
export const SIZES: Record<'desk' | 'mob', Size> = {desk: {w: 1440, h: 900}, mob: {w: 390, h: 844}};

/** focus in Bildanteilen, img in CSS-Pixeln der Aufnahme. Ergebnis in Bildanteilen plus Vergroesserung. */
export function cropFor(focus: R, img: Size, box: Size, minScale: number) {
  let cw = Math.min(img.w, box.w / minScale);
  let ch = (cw * box.h) / box.w;
  if (ch > img.h) { ch = img.h; cw = (ch * box.w) / box.h; }
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(v, hi));
  const x = clamp((focus.x + focus.w / 2) * img.w - cw / 2, img.w - cw);
  const y = clamp((focus.y + focus.h / 2) * img.h - ch / 2, img.h - ch);
  return {x: x / img.w, y: y / img.h, w: cw / img.w, h: ch / img.h, scale: box.w / cw};
}
