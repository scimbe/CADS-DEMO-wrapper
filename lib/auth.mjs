// bunsenbrenner login for everything that RUNS something (see README, "Login-Pflicht").
//
// Trust model: the wrapper never believes a header sent by the client. The Browser Plane is
// payload-blind (the edge neither adds nor strips X-Gate-Email), so a header on the wire proves
// nothing. Instead the wrapper itself asks the platform's login gate -- the same endpoint Caddy's
// forward_auth uses elsewhere -- `GET <DEMO_GATE_CHECK_URL>` over TLS, forwarding ONLY the visitor's
// `ct_gate_session` cookie and a fixed `X-Forwarded-Host` taken from operator config (never from the
// request). The identity is read from THAT response (`X-Gate-Email`), so a client cannot forge it:
// a forged cookie fails the gate's HMAC check, a forged X-Gate-Email request header is never read.
//
// Fail closed: anything but "200 + non-empty email containing '@'" is "not logged in" (a hostname
// without require_login answers 200 with an EMPTY email -- that is "not gated", not "logged in";
// `share:<id>` subjects from share links are no bunsenbrenner account and are refused too). A gate
// outage answers 503, never "allowed".
import { createHash, createHmac, randomBytes } from 'node:crypto';

const COOKIE = 'ct_gate_session';
// Public by design: gallery, demo pages, static assets, builder assets, status, template metadata.
// Everything else below /api/ is default-deny, so a future /api/podcast is gated without a code change.
const PUBLIC_API = [/^\/api\/status$/, /^\/api\/template\/[a-z0-9-]+$/];
const hasApi = (p) => p === '/api' || p.startsWith('/api/');

export function createAuth(opts = {}) {
  const env = opts.env ?? process.env;
  const mode = String(env.DEMO_AUTH_MODE || 'off').toLowerCase();
  if (!['off', 'gate'].includes(mode)) throw new Error(`DEMO_AUTH_MODE must be "off" or "gate", got "${mode}"`);
  const gateCheckUrl = env.DEMO_GATE_CHECK_URL || 'https://bunsenbrenner.org/gate/check';
  const gateHost = String(env.DEMO_GATE_HOST || '').toLowerCase();
  if (mode === 'gate' && !gateHost) throw new Error('DEMO_AUTH_MODE=gate needs DEMO_GATE_HOST (the public hostname of this gallery)');
  const gateBase = new URL(gateCheckUrl).origin;
  const limit = Number(env.DEMO_RUNS_PER_HOUR ?? 20);
  const windowMs = opts.windowMs ?? 3600_000;
  const posTtl = opts.posTtlMs ?? 60_000, negTtl = opts.negTtlMs ?? 5_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((o) => console.log(JSON.stringify(o)));
  // Per-process pepper: the log pseudonym is stable while the process runs and not reversible by
  // dictionary-hashing known addresses. Set DEMO_AUTH_LOG_SALT to correlate across restarts.
  const pepper = env.DEMO_AUTH_LOG_SALT || randomBytes(16).toString('hex');
  const pseudo = (email) => createHmac('sha256', pepper).update(email.toLowerCase()).digest('hex').slice(0, 12);

  const cache = new Map(); // sha256(cookie) -> { exp, email|null }
  const runs = new Map();  // account pseudonym -> [timestamps]

  const sessionCookie = (req) => {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const t = part.trim();
      if (t.startsWith(COOKIE + '=')) return t.slice(COOKIE.length + 1);
    }
    return '';
  };

  // -> { email } | { email: null } (not logged in) | { error: true } (gate unreachable)
  async function identify(req) {
    const cookie = sessionCookie(req);
    if (!cookie || !/^[\x21-\x7e]{1,2048}$/.test(cookie) || /[;,\s]/.test(cookie)) return { email: null };
    const key = createHash('sha256').update(cookie).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.exp > now()) return { email: hit.email };
    try {
      const r = await doFetch(gateCheckUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
        headers: { cookie: `${COOKIE}=${cookie}`, 'x-forwarded-host': gateHost, 'x-forwarded-uri': '/', accept: 'application/json' },
      });
      const email = String(r.headers.get('x-gate-email') || '').trim();
      const ok = r.status === 200 && email.includes('@') && !email.startsWith('share:') && email.length <= 254;
      if (r.status >= 500) return { error: true };
      if (cache.size > 5000) cache.clear();
      cache.set(key, { exp: now() + (ok ? posTtl : negTtl), email: ok ? email : null });
      return { email: ok ? email : null };
    } catch {
      return { error: true };
    }
  }

  // Same-site path only, matching the gate's own rule (ASCII graphic, no ';' or ','): the value ends up
  // in the gate's redirect-after-login, so it must never name another origin.
  const safeReturn = (p) => (typeof p === 'string' && /^\/[\x21-\x7e]*$/.test(p) && !p.startsWith('//') && !/[;,\\]/.test(p) ? p : '/');
  const loginUrl = (ret) => `${gateBase}/gate/start?host=${encodeURIComponent(gateHost)}&return=${encodeURIComponent(safeReturn(ret))}`;

  function rateLimit(id) {
    const t = now();
    const arr = (runs.get(id) || []).filter((x) => t - x < windowMs);
    if (arr.length >= limit) { runs.set(id, arr); return Math.max(1, Math.ceil((arr[0] + windowMs - t) / 1000)); }
    arr.push(t); runs.set(id, arr);
    if (runs.size > 5000) for (const [k, v] of runs) if (!v.some((x) => t - x < windowMs)) runs.delete(k);
    return 0;
  }

  const json = (res, status, body, extra = {}) =>
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }).end(JSON.stringify(body));

  // Returns true when the request was answered here (caller must `return`).
  async function guard(req, res, url) {
    try { return await guardInner(req, res, url); } catch (e) {
      log({ event: 'auth-error', error: String(e && e.message || e) });
      if (!res.headersSent) json(res, 503, { error: 'auth-unavailable' });
      return true;
    }
  }
  async function guardInner(req, res, url) {
    if (mode === 'off') return false;
    const p = url.pathname;
    if (p === '/auth/login') {
      res.writeHead(302, { Location: loginUrl(url.searchParams.get('return')), 'Cache-Control': 'no-store' }).end(); return true;
    }
    if (p === '/auth/me') {
      const id = await identify(req);
      json(res, id.error ? 503 : 200, { authenticated: !!id.email, login_url: loginUrl(url.searchParams.get('return')) }); return true;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (p === '/' || /^\/d\/[a-z0-9-]+\/?$/.test(p))) injectBanner(res);
    if (!hasApi(p) || PUBLIC_API.some((re) => re.test(p))) return false;

    const id = await identify(req);
    if (id.error) { json(res, 503, { error: 'auth-unavailable', message: 'Die Anmeldung ist gerade nicht erreichbar. Bitte spaeter erneut versuchen.' }, { 'Retry-After': '10' }); return true; }
    if (!id.email) {
      let ret = '/';
      try { const ref = new URL(req.headers.referer || ''); if (ref.host.toLowerCase() === gateHost) ret = ref.pathname + ref.search; } catch {}
      json(res, 401, { error: 'login-required', message: 'Mit bunsenbrenner-Konto anmelden, um Demos auszufuehren.', login_url: loginUrl(ret) }); return true;
    }
    const who = pseudo(id.email);
    const wait = rateLimit(who);
    if (wait) {
      log({ event: 'auth-rate-limited', account: who, path: p });
      json(res, 429, { error: 'rate-limited', message: `Limit erreicht (${limit} Laeufe pro Stunde).`, retry_after: wait }, { 'Retry-After': String(wait) }); return true;
    }
    log({ event: 'auth-run', account: who, path: p });
    return false;
  }

  // Adds a "Mit bunsenbrenner-Konto anmelden" bar to the HTML pages without touching their templates.
  function injectBanner(res) {
    const end = res.end.bind(res);
    res.end = (chunk, ...rest) => {
      if (typeof chunk === 'string' && chunk.includes('</body>')) chunk = chunk.replace('</body>', () => BANNER + '</body>');
      return end(chunk, ...rest);
    };
  }

  return { mode, guard, identify, loginUrl, pseudo };
}

const BANNER = `<div id="bb-auth" hidden role="region" aria-label="Anmeldung" style="position:sticky;bottom:0;z-index:50;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:10px 16px;background:#141b2c;color:#eef1f7;border-top:1px solid #2a3450;font:14px/1.4 system-ui,sans-serif"><span id="bb-auth-t"></span><a id="bb-auth-a" style="background:#5fb8ab;color:#0c111d;padding:6px 14px;border-radius:6px;font-weight:600;text-decoration:none"></a></div><script>(function(){var en=document.documentElement.lang==='en',b=document.getElementById('bb-auth');fetch('/auth/me?return='+encodeURIComponent(location.pathname+location.search),{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){if(j.authenticated)return;document.getElementById('bb-auth-t').textContent=en?'Browsing is open. Running demos needs a bunsenbrenner account.':'Ansehen ist frei. Zum Ausf\\u00fchren von Demos ist ein bunsenbrenner-Konto n\\u00f6tig.';var a=document.getElementById('bb-auth-a');a.textContent=en?'Sign in with your bunsenbrenner account':'Mit bunsenbrenner-Konto anmelden';a.href=j.login_url;b.hidden=false;b.style.display='flex'}).catch(function(){})})();</script>`;
