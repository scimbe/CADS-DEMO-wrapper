// My Daily Idea: the AI seal. Every answer the model produced carries one, so a receiver (and a reviewer of a report) can tell
// "this came out of our AI, unchanged" from "somebody typed this" (AI Act Art. 50: machine-readable marking).
//
//   seal = "s1.<kind>.<at, base 36 ms>.<HMAC-SHA256(secret, 's1\n' + kind + '\n' + at + '\n' + canonical(content)), base64url, 32 chars>"
//
// canonical() is JSON with sorted object keys, so the same content gives the same seal whatever order the keys come in.
// Any change to kind, time or content (one character, one colour) makes the seal fail. The secret never leaves the server.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SEAL_RE = /^s1\.([a-z]{1,16})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{32})$/;

/** JSON with sorted keys; undefined values are left out like JSON.stringify does. */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map((x) => canonical(x === undefined ? null : x)).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

export function makeSealer(secret) {
  const sig = (kind, at, content) => createHmac('sha256', String(secret)).update(`s1\n${kind}\n${at}\n${canonical(content)}`).digest('base64url').slice(0, 32);
  /** -> seal string for this kind, content and time (ms). */
  function seal(kind, content, at) {
    if (!/^[a-z]{1,16}$/.test(kind)) throw new Error('bad-kind');
    return `s1.${kind}.${Math.floor(at).toString(36)}.${sig(kind, Math.floor(at), content)}`;
  }
  /** -> { valid, kind, at } ; valid only when the seal was made by this server for exactly this content. */
  function verify(s, content) {
    const m = typeof s === 'string' ? s.match(SEAL_RE) : null;
    if (!m) return { valid: false };
    const kind = m[1], at = parseInt(m[2], 36);
    const want = Buffer.from(sig(kind, at, content)), got = Buffer.from(m[3]);
    return { valid: want.length === got.length && timingSafeEqual(want, got), kind, at };
  }
  return { seal, verify };
}
