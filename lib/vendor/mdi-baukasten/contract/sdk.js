// SDK fuer Kartenlogik: nur spezifiziert exakte Operationen (Ganzzahl, Festkomma Q16.16, Bitoperationen, BigInt).
// Keine approximierten Math-Funktionen, kein Zufall ausser dem Seed, keine Uhr (08-forschung/determinismus.md).
// Gleicher Seed + gleiche Eingaben => gleicher Zustandshash auf jeder Engine.

export const SDK_VERSION = "mdi-sdk/0.2"; // additiv zu 0.1 (ADR 0001): mulberry32, rng.state/rngFrom, expD, sinD, cosD, stateHashF

// ---------- Seed-RNG: xoshiro128** auf uint32, gesaet ueber splitmix32 ----------
function splitmix32(s) {
  s = (s + 0x9e3779b9) | 0;
  let z = s;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return [s, (z ^ (z >>> 16)) >>> 0];
}
function rotl(x, k) { return (x << k) | (x >>> (32 - k)); }

/** Erzeugt einen RNG aus einer Zeichenkette oder uint32. Rueckgabe: { u32(), int(n), pick(arr), shuffle(arr) }. */
export function rng(seed) {
  const st = new Array(4);
  if (Array.isArray(seed)) {
    // Fortsetzung aus einem gespeicherten Zustand (rngFrom): vier uint32
    if (seed.length !== 4 || !seed.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffffffff)) throw new RangeError("rng: Zustand");
    for (let i = 0; i < 4; i++) st[i] = seed[i];
  } else if (typeof seed === "string") {
    // 128 Bit Zustand aus SHA-256 der Zeichenkette (Seeds aus Commit-Reveal haben 128 Bit Entropie)
    const h = sha256("mdi-rng|" + seed);
    for (let i = 0; i < 4; i++) st[i] = parseInt(h.slice(i * 8, i * 8 + 8), 16) >>> 0;
  } else {
    let s0 = seed >>> 0;
    for (let i = 0; i < 4; i++) { const r = splitmix32(s0); s0 = r[0]; st[i] = r[1]; }
  }
  if ((st[0] | st[1] | st[2] | st[3]) === 0) st[0] = 1;
  function u32() {
    const result = Math.imul(rotl(Math.imul(st[1], 5), 7), 9) >>> 0;
    const t = st[1] << 9;
    st[2] ^= st[0]; st[3] ^= st[1]; st[1] ^= st[2]; st[0] ^= st[3];
    st[2] ^= t; st[3] = rotl(st[3], 11);
    return result;
  }
  // gleichverteilt in [0, n) ohne Modulo-Schiefe (Verwerfen)
  function int(n) {
    if (!(n >= 1 && n <= 0x100000000) || Math.floor(n) !== n) throw new RangeError("rng.int: n");
    const lim = 0x100000000 - (0x100000000 % n);
    for (;;) { const x = u32(); if (x < lim) return x % n; }
  }
  return {
    u32, int,
    /** Zustand als uint32[4] fuer den Spielzustand (serialisierbar, kanonisch). */
    state() { return [st[0] >>> 0, st[1] >>> 0, st[2] >>> 0, st[3] >>> 0]; },
    pick(a) { return a[int(a.length)]; },
    shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = int(i + 1); const t = b[i]; b[i] = b[j]; b[j] = t; } return b; }
  };
}

// ---------- Hash ----------
export function fnv1a(str) {
  let h = 0x811c9dc5;
  const b = utf8(str);
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function utf8(str) { return new TextEncoder().encode(String(str)); }

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
/** SHA-256 (FIPS 180-4) synchron, Ergebnis als Hex. Eingabe: Zeichenkette (UTF-8) oder Uint8Array. */
export function sha256(input) {
  const msg = typeof input === "string" ? utf8(input) : input;
  const l = msg.length, nb = ((l + 9 + 63) >> 6) << 6, b = new Uint8Array(nb);
  b.set(msg); b[l] = 0x80;
  const bits = l * 8;
  b[nb - 4] = (bits >>> 24) & 255; b[nb - 3] = (bits >>> 16) & 255; b[nb - 2] = (bits >>> 8) & 255; b[nb - 1] = bits & 255;
  b[nb - 5] = Math.floor(bits / 0x100000000) & 255;
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Array(64);
  for (let o = 0; o < nb; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      const s0 = (rotl(x, 25) ^ rotl(x, 14) ^ (x >>> 3)), s1 = (rotl(y, 15) ^ rotl(y, 13) ^ (y >>> 10));
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotl(e, 26) ^ rotl(e, 21) ^ rotl(e, 7), ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = rotl(a, 30) ^ rotl(a, 19) ^ rotl(a, 10), maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

/** Kanonische Serialisierung: Schluessel sortiert, nur JSON-Typen, keine Gleitkommazahlen mit Nachkommastellen. */
export function canon(v) {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new TypeError("canon: nur Ganzzahlen im Spielzustand");
    return String(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  throw new TypeError("canon: Typ " + typeof v);
}
export function stateHash(v) { return sha256(canon(v)).slice(0, 16); }

// ---------- Festkomma Q16.16 ----------
export const ONE = 65536;
export function fx(n) { return n * ONE; }
export function mulFx(a, b) { return ((a >> 16) * b + Math.floor((a & 0xffff) * b / ONE)) | 0; }
export function divFx(a, b) { if (b === 0) throw new RangeError("divFx: 0"); return Math.trunc(a * ONE / b) | 0; }
export function isqrt(n) {
  if (n < 0) throw new RangeError("isqrt");
  if (n < 2) return n;
  let x = Math.floor(Math.sqrt(n)); // sqrt ist exakt spezifiziert (ECMA-262 21.3.2.33)
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

// ---------- Tabellen-Trigonometrie: Winkel in 1/4096 Umdrehung, Ergebnis Q16.16 ----------
// Die Tabelle entsteht aus BigInt-Taylorreihen: nur exakte Ganzzahloperationen, also auf jeder Engine bitgleich.
const QUARTER = 1024;
const SIN_Q = (() => {
  const S = 1n << 60n;
  const PI = 3622009729038561421n; // floor(pi * 2^60)
  const t = new Array(QUARTER + 1);
  for (let i = 0; i <= QUARTER; i++) {
    const x = (PI * BigInt(i)) / BigInt(2 * QUARTER); // x = i/1024 * pi/2, skaliert 2^60
    let term = x, sum = x, k = 1n;
    for (let n = 0; n < 14; n++) {
      term = -(term * x / S * x / S) / ((2n * k) * (2n * k + 1n));
      sum += term; k++;
    }
    t[i] = Number((sum * 65536n + S / 2n) / S);
  }
  return t;
})();
export function sinT(a) {
  a = ((a % 4096) + 4096) % 4096;
  const q = a >> 10, r = a & 1023;
  if (q === 0) return SIN_Q[r];
  if (q === 1) return SIN_Q[QUARTER - r];
  if (q === 2) return (-SIN_Q[r]) | 0;
  return (-SIN_Q[QUARTER - r]) | 0;
}
export function cosT(a) { return sinT(a + 1024); }
/** atan2 ueber Bisektion auf der Tabelle; Ergebnis in 1/4096 Umdrehung [0, 4096). Eingaben Ganzzahl. */
export function atan2T(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y);
  // Winkel im ersten Oktanten-Paar [0,1024]: finde a mit sin(a)*ax ~ cos(a)*ay
  let lo = 0, hi = 1024;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (sinT(m) * ax < cosT(m) * ay) lo = m; else hi = m;
  }
  const a = (Math.abs(sinT(lo) * ax - cosT(lo) * ay) <= Math.abs(sinT(hi) * ax - cosT(hi) * ay)) ? lo : hi;
  if (x >= 0 && y >= 0) return a % 4096;
  if (x < 0 && y >= 0) return 2048 - a;
  if (x < 0 && y < 0) return 2048 + a;
  return (4096 - a) % 4096;
}

export function clampInt(v, lo, hi) { v = Math.trunc(Number(v)); if (!Number.isFinite(v)) return lo; return v < lo ? lo : v > hi ? hi : v; }

/** Natuerlicher Logarithmus nur aus +, -, *, / (IEEE-754 exakt gerundet, ECMA-262 6.1.6.1) – bitgleich auf allen
 *  Engines, anders als Math.log. Fuer x > 0. Fehler < 1e-14 relativ. */
const LN2 = 0.6931471805599453;
export function logD(x) {
  if (!(x > 0)) throw new RangeError("logD");
  let k = 0;
  while (x >= 2) { x = x / 2; k++; }
  while (x < 1) { x = x * 2; k--; }
  const y = (x - 1) / (x + 1), y2 = y * y;
  let term = y, sum = 0;
  for (let n = 1; n < 60; n += 2) { sum = sum + term / n; term = term * y2; }
  return 2 * sum + k * LN2;
}

/** RNG aus einem gespeicherten Zustand (rng(...).state()). */
export function rngFrom(state) { return rng(state); }

/** mulberry32 aus dem Altcode (core.js:315), nur imul/xor/shift: Werte in [0,1) als float64 (bitgleich auf allen
 *  Engines, da Division durch 2^32 exakt ist). Fuer portierte Engines mit Golden-Werten aus dem Altcode. */
export function mulberry32(a) {
  a = a >>> 0;
  const f = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.state = () => a;
  return f;
}

// ---------- float64 nur aus + - * / (IEEE-754 exakt gerundet, ECMA-262 6.1.6.1) ----------
// Fuer rt.numeric "f64": bitgleich auf allen Engines, anders als Math.exp/sin/cos.
const TWO_PI_HI = 6.283185307179586, TWO_PI_LO = 2.4492935982947064e-16;
const LN2_HI = 0.6931471803691238, LN2_LO = 1.9082149292705877e-10;
/** e^x, relativer Fehler < 1e-15 fuer |x| <= 700. */
export function expD(x) {
  if (x !== x) return x;
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x / 0.6931471805599453);
  const r = (x - k * LN2_HI) - k * LN2_LO;
  let term = 1, sum = 1;
  for (let n = 1; n < 28; n++) { term = term * r / n; sum = sum + term; }
  let s = sum;
  if (k > 0) for (let i = 0; i < k; i++) s = s * 2; else for (let i = 0; i < -k; i++) s = s / 2;
  return s;
}
function reduce2pi(x) { const k = Math.round(x / TWO_PI_HI); return (x - k * TWO_PI_HI) - k * TWO_PI_LO; }
/** sin(x) im Bogenmass, Fehler < 1e-15 fuer |x| <= 1e6. */
export function sinD(x) {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const r = reduce2pi(x), r2 = r * r;
  let term = r, sum = r;
  for (let n = 1; n < 22; n++) { term = -term * r2 / ((2 * n) * (2 * n + 1)); sum = sum + term; }
  return sum;
}
export function cosD(x) {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const r = reduce2pi(x), r2 = r * r;
  let term = 1, sum = 1;
  for (let n = 1; n < 22; n++) { term = -term * r2 / ((2 * n - 1) * (2 * n)); sum = sum + term; }
  return sum;
}

/** Kanonische Serialisierung wie canon, aber Gleitkommazahlen als Bit-Hex ("f:" + 16 Hex) – fuer rt.numeric "f64". */
const F64 = new DataView(new ArrayBuffer(8));
export function canonF(v) {
  if (typeof v === "number" && !Number.isInteger(v)) { F64.setFloat64(0, v); let h = "f:"; for (let i = 0; i < 8; i++) h += F64.getUint8(i).toString(16).padStart(2, "0"); return JSON.stringify(h); }
  if (typeof v === "number" && Object.is(v, -0)) return "\"f:8000000000000000\"";
  if (Array.isArray(v)) return "[" + v.map(canonF).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonF(v[k])).join(",") + "}";
  return canon(v);
}
export function stateHashF(v) { return sha256(canonF(v)).slice(0, 16); }
