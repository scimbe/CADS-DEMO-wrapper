// The link format of the new app (scimbe/CADS-agent-marketplace apps/mdi): #v2.<type>.<base64url(JSON)>, spec in
// apps/mdi src/app/link.js (decode) and src/schema/link.schema.json (the envelope per type). The server takes the fragment
// without "#", the way the app sends it to POST /api/s and keeps it in a wall entry of "Meins".
//
// Only two types are kept on this server: card (a card with its settings) and challenge (a card plus the moves of a duel).
// live carries a one-time token of a live session and ghost a whole recorded run: neither is ever stored here.
//
// Checks, in this order, each one refuses with a reason and never repairs: size before anything is parsed, the character
// set (prefix, type, base64url alphabet), canonical base64url (no padding, no stray bits: one link has one spelling),
// UTF-8 fatal, JSON, then the envelope of the type exactly as link.schema.json says (no unknown keys, fixed patterns and
// limits). The card's own parameters (p) are the card's business: here they are only a plain object of at most 48 keys.

// The app's MAX_FRAGMENT is 4000 characters including "#".
export const V2_MAX = 3999;
export const V2_TYPES = ['card', 'challenge'];
export const V2_RE = /^v2\.(card|challenge)\.([A-Za-z0-9_-]+)$/;

const CARD_ID = /^[a-z][a-z0-9-]{1,31}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const HEX16 = /^[0-9a-f]{16}$/, HEX32 = /^[0-9a-f]{32}$/, HEX64 = /^[0-9a-f]{64}$/;
const PROP = /^[A-Za-z0-9_-]{1,24}$/;
const INPUT_T = /^[a-z][a-z0-9-]{0,15}$/;
// link#/$defs/text: at most 2000 characters, no control characters except tab, line feed and carriage return, no < >
const TEXT_BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const only = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));
const has = (o, keys) => keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

/** link#/$defs/value: null, boolean, a bounded integer, text, or arrays and objects of those. */
function value(x) {
  if (x === null || typeof x === 'boolean') return true;
  if (typeof x === 'number') return isInt(x, -2147483648, 4294967295);
  if (typeof x === 'string') return [...x].length <= 2000 && !TEXT_BAD.test(x);
  if (Array.isArray(x)) return x.length <= 256 && x.every(value);
  if (isObj(x)) { const k = Object.keys(x); return k.length <= 32 && k.every((n) => PROP.test(n) && value(x[n])); }
  return false;
}
/** link#/$defs/input: one move of a seat. */
function input(x) {
  if (!isObj(x) || !has(x, ['t', 'seat'])) return false;
  const k = Object.keys(x);
  if (k.length > 16 || !k.every((n) => PROP.test(n))) return false;
  if (typeof x.t !== 'string' || !INPUT_T.test(x.t) || !isInt(x.seat, 0, 9)) return false;
  return k.every((n) => n === 't' || n === 'seat' || value(x[n]));
}
const head = (d) => typeof d.c === 'string' && CARD_ID.test(d.c) && typeof d.v === 'string' && VERSION.test(d.v) && isObj(d.p) && Object.keys(d.p).length <= 48;

/** The envelope of each kept type (link.schema.json $defs card, challenge). */
export const SCHEMA = {
  card: (d) => isObj(d) && has(d, ['c', 'v', 'p']) && only(d, ['c', 'v', 'p']) && head(d),
  challenge: (d) => isObj(d) && has(d, ['c', 'v', 'p', 's', 'k', 'm', 'g']) && only(d, ['c', 'v', 'p', 's', 'k', 'm', 'g', 'h']) && head(d)
    && typeof d.s === 'string' && HEX32.test(d.s)
    && Array.isArray(d.k) && d.k.length <= 10 && d.k.every((c) => c === null || (typeof c === 'string' && HEX64.test(c)))
    && Array.isArray(d.m) && d.m.length <= 1000 && d.m.every(input)
    && typeof d.g === 'string' && HEX16.test(d.g)
    && (d.h === undefined || (typeof d.h === 'string' && HEX16.test(d.h))),
};

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * A v2 fragment without "#" -> { ok: true, type, data } | { ok: false, reason }.
 * reason: leer | zu-lang | praefix | typ | base64 | utf8 | json | schema (the words of the app's link.js, plus typ for live/ghost).
 */
export function decodeV2(f) {
  if (typeof f !== 'string' || !f) return { ok: false, reason: 'leer' };
  if (f.length > V2_MAX) return { ok: false, reason: 'zu-lang' };
  const t = /^v2\.([a-z]{1,16})\.(.*)$/s.exec(f);
  if (!t) return { ok: false, reason: 'praefix' };
  if (!V2_TYPES.includes(t[1])) return { ok: false, reason: 'typ' };
  const m = V2_RE.exec(f);
  if (!m || m[2].length % 4 === 1) return { ok: false, reason: 'base64' };
  const bytes = Buffer.from(m[2], 'base64url');
  if (bytes.toString('base64url') !== m[2]) return { ok: false, reason: 'base64' };
  let text; try { text = utf8.decode(bytes); } catch { return { ok: false, reason: 'utf8' }; }
  let data; try { data = JSON.parse(text); } catch { return { ok: false, reason: 'json' }; }
  if (!SCHEMA[m[1]](data)) return { ok: false, reason: 'schema' };
  return { ok: true, type: m[1], data };
}
/** The fragment for a type and its data (tests and tools; the app encodes its own links). */
export function encodeV2(type, data) {
  if (!V2_TYPES.includes(type) || !SCHEMA[type](data)) throw new Error('link-v2: schema ' + type);
  const f = `v2.${type}.` + Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  if (f.length > V2_MAX) throw new Error('link-v2: zu-lang');
  return f;
}
