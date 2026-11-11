// My Daily Idea, file tool ("Datei rueber"): the TURN relay only for paying accounts (credit > 0, lib/duell-credit.mjs).
// Decided 2026-11: a free person may still receive over a paying partner's relay; the free side never gets its own TURN
// login. This route checks the account and signs the grant; the bridge (CADS-webconference-demo /api/play/ice) hands out
// TURN for a file channel only against it (lib/relay-grant.mjs). Nothing here spends credit.
//
//   POST /api/duell/relay-grant   login (gate cookie, or Bearer from the apps: lib/oidc-bearer.mjs)
//     {}                      -> 200 { ok: true, relay: true, credit }               may this account use the relay?
//     { channel: <hex64> }    -> 200 { ok: true, relay: true, credit, grant, exp }   a grant bound to that channel
//                             | 402 { ok: false, error: "credit", credit: 0 } | 401 { ok: false, error: "login" }
//                             | 400 "bad-channel" | 429 "limit" | 503 "off" (no secret) / "auth-unavailable"
//
//   DUELL_RELAY_GRANT_SECRET (or DUELL_RELAY_GRANT_SECRET_FILE): shared with the bridge, at least 32 characters.
//   DUELL_RELAY_GRANT_TTL_S (900, at most 900), DUELL_RELAY_GRANTS_PER_HOUR (60, per account).
// Logs carry no account, no channel and no grant: only the outcome.
import { readFileSync } from 'node:fs';
import { signRelayGrant, MAX_TTL_S, MIN_SECRET } from './relay-grant.mjs';

const HEX64 = /^[0-9a-f]{64}$/i;
const HOUR = 3600_000;
const posInt = (v, d, max) => { const n = Number(v); return v !== undefined && v !== '' && Number.isInteger(n) && n >= 1 ? Math.min(n, max) : d; };

export function readGrantSecret(env = process.env) {
  if (env.DUELL_RELAY_GRANT_SECRET_FILE) { try { return readFileSync(env.DUELL_RELAY_GRANT_SECRET_FILE, 'utf8').trim(); } catch { return ''; } }
  return env.DUELL_RELAY_GRANT_SECRET || '';
}

/**
 * shared: lib/duell.mjs shared (readJson, send). who: lib/duell-ai.mjs who(req, input). acctOf(email): the pot key of a
 * login account (lib/duell-ai.mjs). credit: lib/duell-credit.mjs. bearer: lib/oidc-bearer.mjs (optional).
 */
export function createRelay({ env = process.env, shared, who, acctOf, credit, bearer = null, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)) } = {}) {
  const secret = readGrantSecret(env);
  const on = secret.length >= MIN_SECRET;
  if (!on) log({ event: 'duell-relay-config', note: 'DUELL_RELAY_GRANT_SECRET missing or shorter than 32 characters: file relay grants are off' });
  const ttlS = posInt(env.DUELL_RELAY_GRANT_TTL_S, MAX_TTL_S, MAX_TTL_S);
  const perHour = posInt(env.DUELL_RELAY_GRANTS_PER_HOUR, 60, 100000);
  const hits = new Map();   // acct -> { hour, n } (in memory only)
  const limited = (acct) => {
    const h = Math.floor(now() / HOUR), e = hits.get(acct);
    const n = e && e.hour === h ? e.n + 1 : 1;
    hits.set(acct, { hour: h, n });
    if (hits.size > 50000) hits.delete(hits.keys().next().value);
    return n > perHour;
  };

  /** -> { acct } | { acct: '' } (no login) | { error: true } (login check unreachable). Cookie first, then Bearer. */
  async function account(req) {
    const p = await who(req, {});
    if (p && p.status === 503) return { error: true };
    if (p && !p.error && p.account && p.acct) return { acct: p.acct };
    const h = req.headers.authorization;
    if (bearer && typeof h === 'string' && h.startsWith('Bearer ')) {
      const id = await bearer.identify(h);
      if (id.error) return { error: true };
      if (id.email) return { acct: acctOf(id.email) };
    }
    return { acct: '' };
  }

  /** The decision without HTTP: acct (pot key or ''), channel (hex64 or undefined). */
  function decide(acct, channel) {
    if (!on) return { status: 503, body: { ok: false, error: 'off' } };
    if (channel !== undefined && (typeof channel !== 'string' || !HEX64.test(channel))) return { status: 400, body: { ok: false, error: 'bad-channel' } };
    if (!acct) return { status: 401, body: { ok: false, error: 'login' } };
    let n = 0;
    try { n = credit && credit.available ? Math.max(0, Math.floor(credit.available(acct)) || 0) : 0; } catch { n = 0; }
    if (n <= 0) return { status: 402, body: { ok: false, error: 'credit', credit: 0 } };
    if (channel === undefined) return { status: 200, body: { ok: true, relay: true, credit: n } };
    if (limited(acct)) return { status: 429, body: { ok: false, error: 'limit' } };
    const grant = signRelayGrant({ sub: acct.slice(0, 64), ch: channel.toLowerCase(), ttlS, now: now() }, secret);
    return { status: 200, body: { ok: true, relay: true, credit: n, grant, exp: Math.floor(now() / 1000) + ttlS } };
  }

  async function route(req, res, url) {
    if (url.pathname !== '/api/duell/relay-grant') return false;
    const { cors, json } = await shared.readJson(req, res, 'POST, OPTIONS', 512);
    if (json === undefined) return true;
    const send = (r) => shared.send(res, r.status, r.body, cors.headers);
    if (!json || typeof json !== 'object' || Array.isArray(json)) { send({ status: 400, body: { ok: false, error: 'bad-json' } }); return true; }
    if (!on) { send({ status: 503, body: { ok: false, error: 'off' } }); return true; }
    const a = await account(req);
    if (a.error) { send({ status: 503, body: { ok: false, error: 'auth-unavailable' } }); return true; }
    const r = decide(a.acct, json.channel);
    log({ event: 'duell-relay-grant', status: r.status, probe: json.channel === undefined });
    send(r);
    return true;
  }
  return { route, decide, account, on: () => on };
}
