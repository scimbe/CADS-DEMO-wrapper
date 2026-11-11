// App login (iOS/Android) as a second CREDENTIAL for the one identity function in lib/auth.mjs: an OIDC access token
// from the bunsenbrenner Keycloak realm, sent as `Authorization: Bearer <jwt>` by the native app shell (never by page JS).
// It yields the same account key as the gate cookie (the e-mail address), so every policy stays where it is (server side).
//
// Verification (RFC 9068 / RFC 9700 §2.3 / RFC 8725), all fail closed:
//   * compact JWS, at most 8 KiB, header alg from an allowlist (RS256, ES256) that must equal the JWK's own alg/kty/crv,
//     no `crit`, `kid` required; the key comes only from the issuer's JWKS (never from the token: no jku/x5u/jwk).
//   * iss exact; aud contains the configured audience; azp in the configured client list; exp required, nbf/iat honoured,
//     each with a small skew; typ "Bearer" (Keycloak access token; ID and refresh tokens carry other types);
//     a token bound to a key (`cnf`, DPoP / mTLS) is refused: this server takes only bearer tokens (RFC 9449 §7).
//   * email: a real address (contains '@', no `share:` subject, at most 254 chars) AND email_verified === true.
// JWKS: fetched over https with a timeout, cached (10 min), refetched at most every 30 s when a new `kid` shows up
// (key rotation), so a flood of random kids cannot make us hammer Keycloak. Without usable keys the answer is
// "unavailable" (503), never "allowed".
//
// Off unless DEMO_OIDC_ISSUER, DEMO_OIDC_AUDIENCE and DEMO_OIDC_CLIENT_IDS are all set; a partial setup refuses to start.
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

const ALGS = { RS256: { kty: 'RSA' }, ES256: { kty: 'EC', crv: 'P-256' } };
const MAX_TOKEN = 8192;
const B64URL = /^[A-Za-z0-9_-]+$/;

export function createBearer(opts = {}) {
  const env = opts.env ?? process.env;
  const issuer = String(env.DEMO_OIDC_ISSUER || '').replace(/\/+$/, '');
  const audience = String(env.DEMO_OIDC_AUDIENCE || '');
  const clients = String(env.DEMO_OIDC_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const set = [issuer, audience, clients.length ? 'x' : ''].filter(Boolean).length;
  if (set === 0) return { enabled: false, verify: async () => ({ email: null, reason: 'off' }) };
  if (set !== 3) throw new Error('App login needs DEMO_OIDC_ISSUER, DEMO_OIDC_AUDIENCE and DEMO_OIDC_CLIENT_IDS together (or none of them)');
  const iss = new URL(issuer);
  const local = iss.hostname === '127.0.0.1' || iss.hostname === 'localhost';
  if (iss.protocol !== 'https:' && !(local && opts.allowHttpLocal)) throw new Error('DEMO_OIDC_ISSUER must be https');
  const jwksUrl = env.DEMO_OIDC_JWKS_URL || `${issuer}/protocol/openid-connect/certs`;   // Keycloak's fixed path
  if (new URL(jwksUrl).protocol !== 'https:' && !(local && opts.allowHttpLocal)) throw new Error('DEMO_OIDC_JWKS_URL must be https');
  const skew = Number(env.DEMO_OIDC_SKEW_S ?? 30);
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((o) => console.log(JSON.stringify(o)));
  const ttlMs = opts.jwksTtlMs ?? 600_000, minRefetchMs = opts.jwksMinRefetchMs ?? 30_000;

  let keys = new Map();          // kid -> { alg, key }
  let fetchedAt = 0, lastTry = -Infinity, inflight = null;
  const seen = new Map();        // sha256(token) -> { exp, email }  (verified tokens, until min(exp, 60 s))
  const quiet = new Map();       // reason -> last log time (at most one line per reason and minute)

  function importKeys(jwks) {
    const out = new Map();
    for (const k of (jwks && Array.isArray(jwks.keys) ? jwks.keys : [])) {
      if (!k || typeof k.kid !== 'string' || !k.kid) continue;
      if (k.use !== undefined && k.use !== 'sig') continue;                 // Keycloak also lists an RSA-OAEP 'enc' key
      const alg = k.alg;
      if (!Object.hasOwn(ALGS, alg) || k.kty !== ALGS[alg].kty || (ALGS[alg].crv && k.crv !== ALGS[alg].crv)) continue;
      try {
        const key = createPublicKey({ key: { kty: k.kty, n: k.n, e: k.e, crv: k.crv, x: k.x, y: k.y }, format: 'jwk' });
        if (alg === 'RS256' && key.asymmetricKeyDetails.modulusLength < 2048) continue;
        out.set(k.kid, { alg, key });
      } catch { /* malformed key: skipped */ }
    }
    return out;
  }

  // -> true when keys could be (re)loaded, false otherwise; never throws
  function refresh() {
    if (inflight) return inflight;
    lastTry = now();
    inflight = (async () => {
      try {
        const r = await doFetch(jwksUrl, { redirect: 'error', signal: AbortSignal.timeout(opts.timeoutMs ?? 3000), headers: { accept: 'application/json' } });
        if (r.status !== 200) throw new Error('jwks status ' + r.status);
        const text = await r.text();
        if (text.length > 65536) throw new Error('jwks too large');
        const next = importKeys(JSON.parse(text));
        if (!next.size) throw new Error('jwks without usable signing key');
        keys = next; fetchedAt = now();
        return true;
      } catch (e) {
        note('jwks-unavailable', String(e && e.message || e).slice(0, 120));
        return false;
      } finally { inflight = null; }
    })();
    return inflight;
  }

  async function keyFor(kid) {
    const stale = now() - fetchedAt > ttlMs;
    // never loaded: retry every 5 s at most; loaded: a new kid or the TTL triggers a refetch at most every 30 s
    if ((stale || !keys.has(kid)) && now() - lastTry >= (fetchedAt === 0 ? 5000 : minRefetchMs)) await refresh();
    // never had keys, or the last good set is older than a day (a withdrawn key must not live on): unreachable
    if (!keys.size || now() - fetchedAt > 86_400_000) return { error: true };
    return keys.get(kid) || null;                             // unknown kid after a (rate-limited) refetch: refused
  }

  function note(reason, detail) {
    const t = now(), last = quiet.get(reason) || -Infinity;
    if (t - last < 60_000) return;
    quiet.set(reason, t);
    log({ event: 'auth-bearer-refused', reason, ...(detail ? { detail } : {}) });
  }
  const no = (reason) => { note(reason); return { email: null, reason }; };

  const part = (s) => { try { return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { return null; } };
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const num = (x) => typeof x === 'number' && Number.isFinite(x);

  // -> { email } | { email: null, reason } | { error: true }
  async function verify(token) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN) return no('format');
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) return no('format');
    const digest = createHash('sha256').update(token).digest('hex');
    const t = now();
    const hit = seen.get(digest);
    if (hit && hit.exp > t) return { email: hit.email };
    const h = part(parts[0]), c = part(parts[1]);
    if (!isObj(h) || !isObj(c)) return no('format');
    if (!Object.hasOwn(ALGS, h.alg)) return no('alg');
    if (h.crit !== undefined || h.jku !== undefined || h.x5u !== undefined || h.jwk !== undefined || h.x5c !== undefined) return no('header');
    if (h.typ !== undefined && !['JWT', 'at+jwt', 'application/at+jwt'].includes(h.typ)) return no('typ');
    if (typeof h.kid !== 'string' || !h.kid) return no('kid');
    const k = await keyFor(h.kid);
    if (k && k.error) return { error: true };
    if (!k) return no('kid');
    if (k.alg !== h.alg) return no('alg');
    const sig = Buffer.from(parts[2], 'base64url');
    const ok = cryptoVerify('sha256', Buffer.from(parts[0] + '.' + parts[1]), h.alg === 'ES256' ? { key: k.key, dsaEncoding: 'ieee-p1363' } : k.key, sig);
    if (!ok) return no('signature');
    // claims
    if (c.iss !== issuer) return no('iss');
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(audience)) return no('aud');
    if (typeof c.azp !== 'string' || !clients.includes(c.azp)) return no('azp');
    if (c.typ !== undefined && c.typ !== 'Bearer') return no('typ');
    if (c.cnf !== undefined) return no('bound');
    const sec = t / 1000;
    if (!num(c.exp) || sec >= c.exp + skew) return no('exp');
    if (c.nbf !== undefined && (!num(c.nbf) || sec < c.nbf - skew)) return no('nbf');
    if (c.iat !== undefined && (!num(c.iat) || c.iat > sec + skew)) return no('iat');
    const email = typeof c.email === 'string' ? c.email.trim() : '';
    if (!email.includes('@') || email.startsWith('share:') || email.length > 254) return no('email');
    if (c.email_verified !== true) return no('email-unverified');
    if (seen.size > 5000) seen.clear();
    seen.set(digest, { exp: Math.min(c.exp * 1000, t + 60_000), email });
    return { email };
  }

  return { enabled: true, verify, issuer, audience, clients, _keys: () => keys };
}

/** `Authorization` header -> { scheme, token } | null (only the two schemes we name; anything else is null). */
export function authHeader(req) {
  const v = req && req.headers ? req.headers.authorization : undefined;
  if (typeof v !== 'string' || !v) return null;
  const m = /^([A-Za-z]+) +([A-Za-z0-9._~+/-]+=*)$/.exec(v.trim());
  if (!m) return { scheme: 'invalid', token: '' };
  return { scheme: m[1].toLowerCase(), token: m[2] };
}
