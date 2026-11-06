// My Daily Idea: the AI seal. Every answer the model produced carries one, so a receiver (and a reviewer of a report) can tell
// "this came out of our AI, unchanged" from "somebody typed this" (AI Act Art. 50: machine-readable marking).
//
//   s2 (new):  "s2.<kind>.<at, base 36 ms>.<HMAC-SHA256(secret, 's2\n' + kind + '\n' + at + '\n' + h), base64url, 32 chars>"
//              h = optionHash(content) = base64url(SHA-256(canonical(content))), 43 characters (the full 32 bytes)
//   s1 (old):  "s1.<kind>.<at>.<HMAC-SHA256(secret, 's1\n' + kind + '\n' + at + '\n' + canonical(content)), base64url, 32 chars>"
//
// s2 binds to the hash of the option, so a sheet that keeps only the seal and h (doc.ki = { k, s, h }) can still be checked
// and reported without carrying the whole option: verify(seal, { hash: h }). Checking against the content itself works for
// both versions. Seals made before s2 (s1) stay valid; they can only be checked against the content.
// canonical() is JSON with sorted object keys, so the same content gives the same seal whatever order the keys come in.
// Any change to kind, time or content (one character, one colour) makes the seal fail. The secret never leaves the server.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SEAL_RE = /^s([12])\.([a-z]{1,16})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{32})$/;
export const HASH_RE = /^[A-Za-z0-9_-]{43}$/;

/** JSON with sorted keys; undefined values are left out like JSON.stringify does. */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map((x) => canonical(x === undefined ? null : x)).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
/** base64url(SHA-256(canonical(content))): 43 characters. What a sheet keeps as doc.ki.h. */
export const optionHash = (content) => createHash('sha256').update(canonical(content)).digest('base64url');

export function makeSealer(secret) {
  const mac = (s) => createHmac('sha256', String(secret)).update(s).digest('base64url').slice(0, 32);
  const sig1 = (kind, at, content) => mac(`s1\n${kind}\n${at}\n${canonical(content)}`);
  const sig2 = (kind, at, h) => mac(`s2\n${kind}\n${at}\n${h}`);
  /** -> s2 seal string for this kind, content and time (ms). */
  function seal(kind, content, at) {
    if (!/^[a-z]{1,16}$/.test(kind)) throw new Error('bad-kind');
    return `s2.${kind}.${Math.floor(at).toString(36)}.${sig2(kind, Math.floor(at), optionHash(content))}`;
  }
  /**
   * -> { valid, kind, at }; valid only when the seal was made by this server for exactly this content.
   * `content` may be { hash: <optionHash> } instead (s2 only): marked by passing opts.hash, or via verifyHash().
   */
  function check(s, content, hash) {
    const m = typeof s === 'string' ? s.match(SEAL_RE) : null;
    if (!m) return { valid: false };
    const ver = m[1], kind = m[2], at = parseInt(m[3], 36);
    let want;
    if (ver === '1') { if (hash !== undefined) return { valid: false, kind, at, why: 's1-needs-content' }; want = sig1(kind, at, content); }
    else { const h = hash !== undefined ? hash : optionHash(content); if (typeof h !== 'string' || !HASH_RE.test(h)) return { valid: false, kind, at }; want = sig2(kind, at, h); }
    const a = Buffer.from(want), b = Buffer.from(m[4]);
    return { valid: a.length === b.length && timingSafeEqual(a, b), kind, at };
  }
  const verify = (s, content) => check(s, content);
  const verifyHash = (s, hash) => (typeof hash === 'string' ? check(s, undefined, hash) : { valid: false });
  /** Both ways in one: the content when there is one, else the hash. */
  const verifyAny = (s, content, hash) => (content !== undefined && content !== null ? check(s, content) : verifyHash(s, hash));
  return { seal, verify, verifyHash, verifyAny, sealV1: (kind, content, at) => `s1.${kind}.${Math.floor(at).toString(36)}.${sig1(kind, Math.floor(at), content)}` };
}
