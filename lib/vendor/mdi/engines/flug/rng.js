// Zufall und Hash des Flugspiels, bitgenau aus dem Altcode (alt:src/core.js hash32, mulberry32).
// Nur Ganzzahloperationen (Math.imul, Verschiebung, XOR) und eine Division durch 2^32: auf jeder Engine bitgleich
// (08-forschung/determinismus.md, Befund 1). Die Strecke eines Seeds ist damit dieselbe wie in jedem alten Link.

/** FNV-1a ueber UTF-16-Codeeinheiten (nicht UTF-8 wie sdk.fnv1a): so rechnete der Altcode jeden Seed aus Text. */
export function hash32(str) {
  let h = 0x811c9dc5;
  str = String(str);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** mulberry32: function() -> [0, 1), Zustand ein uint32. */
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

/** Ein Zug aus mulberry32 auf einem Zustand {r: uint32}: dieselbe Folge wie mulberry32(seed)(), aber serialisierbar. */
export function draw(o) {
  o.r = (o.r + 0x6D2B79F5) >>> 0;
  let t = o.r;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** FNV-1a ueber die exakten float64-Bits: gleicher Hash = gleicher Lauf Bit fuer Bit (alt:src/spur.js mix). */
const dv = new DataView(new ArrayBuffer(8));
export function mixF64(h, x) { dv.setFloat64(0, x); for (let j = 0; j < 8; j++) h = Math.imul(h ^ dv.getUint8(j), 16777619) >>> 0; return h; }
export const FNV0 = 0x811c9dc5;
/** uint32 als 8 Hex-Zeichen, ohne toString(radix) (Harness). */
const HEXD = "0123456789abcdef";
export function hex32(h) { let s = ""; for (let i = 28; i >= 0; i -= 4) s += HEXD[(h >>> i) & 15]; return s; }
