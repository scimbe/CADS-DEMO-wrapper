// Design-Token-Namen: die einzige Farb-/Groessen-/Formsprache, die Karten in ihrer Anzeigeliste benutzen duerfen.
// Werte stehen nur in ui/tokens.css (hell/dunkel), Karten kennen keine Hex-Werte.
export const PALETTE = ["yellow", "red", "ink", "paper"];
export const FILLS = [...PALETTE, "surface", "text", "muted", "line"];
export const SIZES = ["s", "m", "l", "xl", "xxl"];
export const SHAPES = ["star", "heart", "bolt", "drop", "coin", "ring"];
// Schrift auf Flaeche: Kontrast nach WCAG 2.2 (Tinte auf Gelb/Papier/Rot, Papier auf Tinte)
export function onFill(fill) { return fill === "ink" ? "paper" : "ink"; }
