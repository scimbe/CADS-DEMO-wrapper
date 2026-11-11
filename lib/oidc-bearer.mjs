// Bearer login for the My Daily Idea apps (iOS/Android). The apps sign in with OIDC (Authorization Code + PKCE, client
// cads-mobile, realm ct-demo) and never hold a gate cookie, so a route that needs the account (today only
// POST /api/duell/relay-grant, lib/duell-relay.mjs) also accepts `Authorization: Bearer <access token>`.
//
// Trust model: the token is checked here, never believed: RS256 signature against the realm's JWKS (fetched over TLS from
// the issuer, cached, refetched on an unknown key id at most every 30 s), `iss` exactly the configured issuer, `azp` one of
// the allowed clients, not expired (30 s skew), `typ` "Bearer" when present, and a verified e-mail (`email_verified`
// true). The account is that e-mail, lowercased, exactly as the gate cookie gives it (lib/auth.mjs), so the app and the
// browser reach the same credit. Fail closed: anything else is "not logged in"; an unreachable JWKS is an error (503),
// never "allowed". The token is never logged or stored.
//
//   DUELL_BEARER_ISSUER    default https://auth.bunsenbrenner.org/realms/ct-demo; "off" turns Bearer login off
//   DUELL_BEARER_AZP       allowed clients, comma list, default cads-mobile
//   DUELL_BEARER_JWKS_URL  default <issuer>/protocol/openid-connect/certs (Keycloak)
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const B64U = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN = 8192, SKEW_S = 30, JWKS_TTL_MS = 10 * 60_000, JWKS_MIN_GAP_MS = 30_000;

export function createBearer({ env = process.env, fetchImpl = fetch, now = () => Date.now(), timeoutMs = 3000 } = {}) {
  const issuer = String(env.DUELL_BEARER_ISSUER ?? 'https://auth.bunsenbrenner.org/realms/ct-demo').replace(/\/$/, '');
  const on = !!issuer && issuer !== 'off' && /^https:\/\//.test(issuer);
  const azp = new Set(String(env.DUELL_BEARER_AZP ?? 'cads-mobile').split(',').map((s) => s.trim()).filter(Boolean));
  const jwksUrl = env.DUELL_BEARER_JWKS_URL || issuer + '/protocol/openid-connect/certs';
  let keys = new Map(), fetchedAt = 0, lastTry = 0, inflight = null;

  async function loadKeys() {
    if (inflight) return inflight;
    inflight = (async () => {
      lastTry = now();
      const r = await fetchImpl(jwksUrl, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('jwks ' + r.status);
      const body = await r.json();
      const next = new Map();
      for (const k of Array.isArray(body && body.keys) ? body.keys : []) {
        if (!k || k.kty !== 'RSA' || typeof k.kid !== 'string' || (k.use && k.use !== 'sig') || (k.alg && k.alg !== 'RS256')) continue;
        try { next.set(k.kid, createPublicKey({ key: { kty: 'RSA', n: k.n, e: k.e }, format: 'jwk' })); } catch { /* a broken key is skipped */ }
      }
      keys = next; fetchedAt = now();
    })().finally(() => { inflight = null; });
    return inflight;
  }
  async function keyFor(kid) {
    const stale = now() - fetchedAt > JWKS_TTL_MS;
    if ((stale || !keys.has(kid)) && (stale || now() - lastTry >= JWKS_MIN_GAP_MS)) {
      try { await loadKeys(); } catch (e) { if (!keys.size) throw e; }   // a refetch failing keeps the keys we had
    }
    return keys.get(kid) || null;
  }

  /** header: the Authorization header value. -> { email } | { email: null } | { error: true } (JWKS unreachable). */
  async function identify(header) {
    if (!on) return { email: null };
    const m = /^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(String(header || ''));
    if (!m || m[1].length > MAX_TOKEN) return { email: null };
    const parts = m[1].split('.');
    if (parts.length !== 3 || !parts.every((x) => B64U.test(x))) return { email: null };
    let head, claims;
    try { head = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { return { email: null }; }
    if (!head || head.alg !== 'RS256' || typeof head.kid !== 'string' || !claims || typeof claims !== 'object') return { email: null };
    let key;
    try { key = await keyFor(head.kid); } catch { return { error: true }; }
    if (!key) return { email: null };
    let good = false;
    try { good = cryptoVerify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url')); } catch { good = false; }
    if (!good) return { email: null };
    const t = Math.floor(now() / 1000);
    if (claims.iss !== issuer) return { email: null };
    if (!azp.has(claims.azp)) return { email: null };
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_S <= t) return { email: null };
    if (typeof claims.nbf === 'number' && claims.nbf - SKEW_S > t) return { email: null };
    if (claims.typ !== undefined && claims.typ !== 'Bearer') return { email: null };
    const email = typeof claims.email === 'string' ? claims.email.trim() : '';
    if (claims.email_verified !== true || !email.includes('@') || email.length > 254) return { email: null };
    return { email: email.toLowerCase() };
  }
  return { identify, on: () => on };
}
