// Relay grant for the My Daily Idea file tool ("Datei rueber"): the TURN relay is for paying accounts only. This wrapper
// checks the credit (lib/duell-relay.mjs) and signs; the webconference bridge (CADS-webconference-demo bridge/relay-grant.js)
// only verifies, on GET /api/play/ice. Both share DUELL_RELAY_GRANT_SECRET (never logged, never sent to a client).
//
//   grant = "rg1." + b64url(payload) + "." + b64url(HMAC-SHA256(secret, "rg1." + b64url(payload)))
//   payload = { sub, purpose: "file", ch: <channel hex64>, iat, exp }   (seconds since the epoch, exp - iat <= 15 min)
//
// The same format and the same fixed test vector are in the bridge's test (test/play-relay-grant.test.mjs).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const PREFIX = 'rg1.';
export const MAX_TTL_S = 15 * 60;
export const MIN_SECRET = 32;
const SKEW_S = 30, MAX_LEN = 1024;
const HEX64 = /^[0-9a-f]{64}$/, B64U = /^[A-Za-z0-9_-]+$/;
const b64u = (b) => Buffer.from(b).toString('base64url');
const mac = (secret, data) => createHmac('sha256', secret).update(data).digest();

/** A grant for one channel. Throws on a missing or short secret, a bad channel or a TTL above MAX_TTL_S (never signs those). */
export function signRelayGrant({ sub, ch, purpose = 'file', ttlS = MAX_TTL_S, now = Date.now() }, secret) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET) throw new Error('relay grant secret missing or short');
  if (typeof ch !== 'string' || !HEX64.test(ch)) throw new Error('bad channel');
  if (!(ttlS > 0 && ttlS <= MAX_TTL_S)) throw new Error('bad ttl');
  if (typeof sub !== 'string' || !sub || sub.length > 64) throw new Error('bad sub');
  const iat = Math.floor(now / 1000);
  const body = PREFIX + b64u(JSON.stringify({ sub, purpose, ch, iat, exp: iat + Math.floor(ttlS) }));
  return body + '.' + b64u(mac(secret, body));
}

/** -> { ok: true, sub, exp } | { ok: false, why }. The bridge's check, here for tests and for symmetry. */
export function verifyRelayGrant(token, secret, { channel, purpose = 'file', now = Date.now() } = {}) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET) return { ok: false, why: 'off' };
  if (typeof token !== 'string' || !token || token.length > MAX_LEN || !token.startsWith(PREFIX)) return { ok: false, why: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 3 || !B64U.test(parts[1]) || !B64U.test(parts[2])) return { ok: false, why: 'form' };
  const got = Buffer.from(parts[2], 'base64url'), want = mac(secret, PREFIX + parts[1]);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, why: 'sig' };
  let p;
  try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return { ok: false, why: 'form' }; }
  if (!p || typeof p !== 'object') return { ok: false, why: 'form' };
  if (p.purpose !== purpose) return { ok: false, why: 'purpose' };
  const t = Math.floor(now / 1000);
  if (!Number.isInteger(p.exp) || !Number.isInteger(p.iat) || p.exp <= t || p.iat > t + SKEW_S || p.exp - p.iat > MAX_TTL_S) return { ok: false, why: 'time' };
  if (typeof channel !== 'string' || p.ch !== channel.toLowerCase()) return { ok: false, why: 'channel' };
  if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 64) return { ok: false, why: 'sub' };
  return { ok: true, sub: p.sub, exp: p.exp };
}
