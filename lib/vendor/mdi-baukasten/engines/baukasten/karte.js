// Gemeinsame Kartenhilfen des Baukastens (Strang B) fuer "baukasten" und "baukasten-zug": Parameter pruefen und das
// Server-Doc der freien Karte {k:"bau", t, b} abbilden. Karten duerfen keine Geschwisterkarten importieren (scripts/harness.js).
import { check } from "./check.js";
import { compact } from "./spec.js";

/** Beschreibung pruefen; wirft mit Grund (nie still eine andere Karte, A4). */
export function descOf(params, mode = "realtime") {
  const c = check(params && params.desc);
  if (!c.ok) throw new Error("baukasten: Beschreibung ungueltig: " + c.errors.slice(0, 3).join("; "));
  if (c.desc.mode !== mode) throw new Error("baukasten: Art " + c.desc.mode + " gehoert zur Karte " + (c.desc.mode === "turn" ? "baukasten-zug" : "baukasten"));
  return c.desc;
}

/** Server-Doc der freien Karte -> Parameter dieser Karte, oder null (passt nicht / ungueltig). */
export function paramsFromDoc(doc, mode) {
  if (!doc || doc.k !== "bau" || !doc.b || typeof doc.b !== "object") return null;
  const c = check(doc.b);
  return c.ok && c.desc.mode === mode ? { desc: compact(c.desc) } : null;
}
export function docFromParams(params) {
  const c = check(params && params.desc);
  return c.ok ? { k: "bau", t: c.desc.title, b: compact(c.desc) } : null;
}

