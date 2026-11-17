// Seed-Zufall der Altkarten (alt:src/core.js hash32 + mulberry32), bitgleich portiert, damit gleiche Seeds und gleiche
// Eingaben dieselben Ergebnisse wie im Altcode liefern (Golden-Tests gegen das Alt-Orakel). Nur exakt spezifizierte
// Ganzzahloperationen (Math.imul, Schieben, XOR) und eine Division durch 2^32, die in IEEE-754 exakt ist; damit auf
// jeder Engine gleich (08-forschung/determinismus.md). Neue Karten nutzen rng() aus src/contract/sdk.js.

/** FNV-1a ueber UTF-16-Codeeinheiten (wie der Altcode; anders als sdk.fnv1a, das UTF-8 hasht). */
export function hash32(str) {
  let h = 0x811c9dc5;
  str = String(str);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** mulberry32: liefert eine Funktion, die Zahlen in [0, 1) mit 32 Bit Aufloesung ausgibt. */
export function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zufallsquelle zu einem Etikett, wie die Altkarten sie bilden: mulberry32(hash32(tag)). */
export function seeded(tag) { return mulberry32(hash32(tag)); }

/** Mischen nach Fisher-Yates mit einer Quelle r (Reihenfolge der Aufrufe wie im Altcode). */
export function mixIndex(r, n) {
  const a = []; for (let i = 0; i < n; i++) a.push(i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const x = a[i]; a[i] = a[j]; a[j] = x; }
  return a;
}

/** Seed einer Partie als 16 Hex-Zeichen aus dem Init-rng des SDK (der Host gibt der Karte den Partie-Seed nur so). */
const HEX = "0123456789abcdef";
export function gameSeed(rng) {
  let out = "";
  for (let k = 0; k < 2; k++) { const x = rng.u32() >>> 0; for (let i = 28; i >= 0; i -= 4) out += HEX[(x >>> i) & 15]; }
  return out;
}

/** Mehrzahlform eines Textschluessels: "k_one"/"k_other" wenn vorhanden, sonst "k" (alt:src/core.js form). */
export function form(block, k, n, lang) {
  // Deutsch und Englisch kennen fuer ganze Zahlen genau "one" (1) und "other" (CLDR); ohne Intl, damit gleich auf jeder Engine
  const p = n === 1 ? "one" : "other";
  const s = typeof n === "number" ? block[k + "_" + p] : undefined;
  return s !== undefined && s !== null ? s : block[k];
}
export function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (o[k] !== undefined && o[k] !== null ? String(o[k]) : "")); }
