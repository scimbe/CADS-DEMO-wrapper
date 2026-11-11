// App login (iOS/Android) as a second CREDENTIAL for the one identity function in lib/auth.mjs: an OIDC access token
// from the bunsenbrenner Keycloak realm, sent as `Authorization: Bearer <jwt>` by the native app shell (never by page JS).
// It yields the same account key as the gate cookie (the e-mail address), so every policy stays where it is (server side).
//
// Verification (RFC 9068 / RFC 9700 §2.3 / RFC 8725), all fail closed:
//   * compact JWS, at most 8 KiB, header alg from an allowlist (RS256, ES256) that must equal the JWK's own alg/kty/crv,
//     no `crit`, `kid` required; the key comes only from the issuer's JWKS (never from the token: no jku/x5u/jwk).
//   * iss exact; aud contains the configured audience; azp in the configured client list; typ === "Bearer" (Keycloak
//     access token; ID and refresh tokens carry other types); sub required; exp and iat required, exp - iat at most
//     15 min, nbf honoured, all with a 5 s skew; a token bound to a key (`cnf`, DPoP / mTLS) is refused: this server
//     takes only bearer tokens (RFC 9449 §7).
//   * email: a real address (contains '@', no `share:` subject, at most 254 chars) AND email_verified === true.
//   * subject binding: the first (iss, sub) seen for an e-mail address is stored (HMAC keys, DEMO_OIDC_BINDING_FILE);
//     a later token with the same address but another subject is refused. The account key stays the e-mail (same as
//     the gate cookie), so a re-used or re-assigned address at an identity provider cannot take over an account here.
// JWKS: fetched over https with a timeout, body capped at 64 KiB while streaming, cached (10 min), refetched at most
// every 30 s when a new `kid` shows up (key rotation), so a flood of random kids cannot make us hammer Keycloak.
// Concurrent requests wait for a running fetch. Without usable keys, or with keys older than 2 h, the answer is
// "unavailable" (503), never "allowed".
//
// Off unless DEMO_OIDC_ISSUER, DEMO_OIDC_AUDIENCE and DEMO_OIDC_CLIENT_IDS are all set; a partial setup refuses to start,
// and so does a setup without DEMO_OIDC_BINDING_FILE and DEMO_OIDC_BINDING_SALT (at least 16 characters).
import { createHash, createHmac, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

const ALGS = { RS256: { kty: 'RSA' }, ES256: { kty: 'EC', crv: 'P-256' } };
const MAX_TOKEN = 8192;
const MAX_LIFETIME_S = 900;      // exp - iat: Keycloak issues 300 s to cads-mobile; anything longer is not ours
const MAX_JWKS = 65536;
const STALE_MS = 2 * 3600_000;   // last good key set older than this: unavailable (a withdrawn key must not live on)

/**
 * First-seen (iss, sub) per e-mail address, in a small JSON file: { v: 1, b: { HMAC(email): HMAC(iss sub) } }.
 * Nothing in the file is readable without the salt. A corrupt file stops the start (fail closed, not "forget all").
 */
export function createSubjectBinding({ file, salt, log = () => {} }) {
  if (!file || !salt || String(salt).length < 16) throw new Error('App login needs DEMO_OIDC_BINDING_FILE and DEMO_OIDC_BINDING_SALT (at least 16 characters)');
  const mac = (s) => createHmac('sha256', salt).update(s).digest('base64url');
  let b = {};
  if (existsSync(file)) {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (!j || j.v !== 1 || typeof j.b !== 'object' || Array.isArray(j.b)) throw new Error('DEMO_OIDC_BINDING_FILE is not a binding file');
    b = j.b;
  }
  const save = () => { const tmp = file + '.tmp'; writeFileSync(tmp, JSON.stringify({ v: 1, b }), { mode: 0o600 }); renameSync(tmp, file); };
  return {
    /** -> true when (iss, sub) is the one bound to this address (binding it now if there was none). */
    check(email, iss, sub) {
      const k = mac('email:' + email.toLowerCase()), v = mac('sub:' + iss + ' ' + sub);
      if (Object.hasOwn(b, k)) return b[k] === v;
      b[k] = v;
      try { save(); } catch (e) { delete b[k]; log({ event: 'auth-bearer-binding-unwritable' }); return false; }
      return true;
    },
    key: (email) => mac('email:' + String(email).toLowerCase()),
    size: () => Object.keys(b).length,
  };
}
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
  const skew = Number(env.DEMO_OIDC_SKEW_S ?? 5);
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((o) => console.log(JSON.stringify(o)));
  const binding = opts.binding ?? createSubjectBinding({ file: env.DEMO_OIDC_BINDING_FILE, salt: env.DEMO_OIDC_BINDING_SALT, log });
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
        if (Number(r.headers.get('content-length')) > MAX_JWKS) throw new Error('jwks too large');
        const parts = []; let size = 0;
        for await (const chunk of r.body || []) {                 // capped while streaming, not after buffering it all
          size += chunk.length;
          if (size > MAX_JWKS) { try { await r.body.cancel(); } catch { /* already closed */ } throw new Error('jwks too large'); }
          parts.push(Buffer.from(chunk));
        }
        const text = Buffer.concat(parts).toString('utf8');
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
    if (inflight) await inflight;                             // a fetch is running: wait for it instead of answering 503
    const stale = now() - fetchedAt > ttlMs;
    // never loaded: retry every 5 s at most; loaded: a new kid or the TTL triggers a refetch at most every 30 s
    if ((stale || !keys.has(kid)) && now() - lastTry >= (fetchedAt === 0 ? 5000 : minRefetchMs)) await refresh();
    // never had keys, or the last good set is older than a day (a withdrawn key must not live on): unreachable
    if (!keys.size || now() - fetchedAt > STALE_MS) return { error: true };
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
    if (c.typ !== 'Bearer') return no('typ');
    if (c.cnf !== undefined) return no('bound');
    if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 255) return no('sub');
    const sec = t / 1000;
    if (!num(c.exp) || sec >= c.exp + skew) return no('exp');
    if (!num(c.iat) || c.iat > sec + skew) return no('iat');
    if (c.exp - c.iat > MAX_LIFETIME_S) return no('lifetime');
    if (c.nbf !== undefined && (!num(c.nbf) || sec < c.nbf - skew)) return no('nbf');
    const email = typeof c.email === 'string' ? c.email.trim() : '';
    if (!email.includes('@') || email.startsWith('share:') || email.length > 254) return no('email');
    if (c.email_verified !== true) return no('email-unverified');
    if (!binding.check(email, c.iss, c.sub)) return no('subject-changed');
    if (seen.size > 5000) seen.clear();
    seen.set(digest, { exp: Math.min(c.exp * 1000, t + 60_000), email });
    return { email };
  }

  return { enabled: true, verify, issuer, audience, clients, binding, _keys: () => keys };
}

/** `Authorization` header -> { scheme, token } | null (only the two schemes we name; anything else is null). */
export function authHeader(req) {
  const v = req && req.headers ? req.headers.authorization : undefined;
  if (typeof v !== 'string' || !v) return null;
  const m = /^([A-Za-z]+) +([A-Za-z0-9._~+/-]+=*)$/.exec(v.trim());
  if (!m) return { scheme: 'invalid', token: '' };
  return { scheme: m[1].toLowerCase(), token: m[2] };
}
