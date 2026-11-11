// My Daily Idea: "Aufladen per Gutschein" for the free card. A code the operator configured adds credit (lib/duell-credit.mjs
// grant) to the login account that redeems it; the credit is then spent like earned credit once the free pot is empty.
//
//   POST /api/duell/credit/redeem   login, { code } -> 200 { ok: true, added, credit }
//                                   | { ok: false, error: "off" (503) | "login" (401) | "unknown" (403) | "limit" (429) }
//
// Codes live only in the environment, never in the repository:
//   DUELL_VOUCHERS = comma list of  sha256hex:amount:perAcctPerDay:globalPerDay:reusable
//     sha256hex      SHA-256 (hex, 64 chars) of the code, uppercase and trimmed:  printf %s 'MEIN-CODE' | shasum -a 256
//     amount         cards added per redemption (1..100)
//     perAcctPerDay  redemptions per account and UTC day (1..1000)
//     globalPerDay   redemptions of this code by all accounts per UTC day (1..100000)
//     reusable       1: the same account may redeem it again (within perAcctPerDay); 0: once per account, ever
//   Without DUELL_VOUCHERS (or without one valid entry) the route answers "off".
//   DUELL_VOUCHER_TRIES_PER_HOUR (5): wrong codes per account and per IP an hour; then "limit" for the rest of the hour.
//
// What keeps it safe: the code is compared as its SHA-256 with timingSafeEqual against every entry (no early exit), never
// logged or stored; a log line carries only the first 8 hex characters of the hash of a known code. The credit it adds
// does not bypass anything else: the monthly cost cap of the model layer and DUELL_CREATE_CALLS_PER_DAY stay in force, and
// credit is only spent once the free pot is empty (lib/duell-ai.mjs useCredit). Nothing here sells or takes payment.

import { createHash, timingSafeEqual } from 'node:crypto';

const ENTRY_RE = /^([0-9a-f]{64}):(\d{1,3}):(\d{1,4}):(\d{1,6}):([01])$/;
const DAY = 86400000, HOUR = 3600000;
const sha = (s) => createHash('sha256').update(s, 'utf8').digest();
export const normCode = (c) => String(c).trim().toUpperCase();

/** -> { list: [{ hash: Buffer, tag, amount, perAcct, global, reusable }], bad } */
export function parseVouchers(raw) {
  const list = []; let bad = 0;
  for (const part of String(raw || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    const m = part.match(ENTRY_RE);
    const amount = m ? Number(m[2]) : 0, perAcct = m ? Number(m[3]) : 0, global = m ? Number(m[4]) : 0;
    if (!m || amount < 1 || amount > 100 || perAcct < 1 || perAcct > 1000 || global < 1 || global > 100000) { bad++; continue; }
    list.push({ hash: Buffer.from(m[1], 'hex'), tag: m[1].slice(0, 16), amount, perAcct, global, reusable: m[5] === '1' });
  }
  return { list, bad };
}

/**
 * shared: lib/duell.mjs shared (readJson, send, clientKey). who: lib/duell-ai.mjs who(req, input). credit: lib/duell-credit.mjs.
 */
export function createVouchers({ env = process.env, shared, who, credit, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)) } = {}) {
  const { list, bad } = parseVouchers(env.DUELL_VOUCHERS);
  if (bad) log({ event: 'duell-voucher-config', note: `${bad} DUELL_VOUCHERS entr${bad === 1 ? 'y' : 'ies'} not valid: ignored` });
  const triesMax = (() => { const n = Number(env.DUELL_VOUCHER_TRIES_PER_HOUR); return env.DUELL_VOUCHER_TRIES_PER_HOUR !== undefined && env.DUELL_VOUCHER_TRIES_PER_HOUR !== '' && Number.isInteger(n) && n >= 1 ? n : 5; })();
  const wrong = new Map();   // 'a:' + account | 'i:' + ip hash -> { hour, n }: wrong codes this hour (in memory only)
  const hourNow = () => Math.floor(now() / HOUR);
  const tries = (k) => { const e = k && wrong.get(k); return e && e.hour === hourNow() ? e.n : 0; };
  const miss = (k) => { if (!k) return; wrong.set(k, { hour: hourNow(), n: tries(k) + 1 }); if (wrong.size > 50000) wrong.delete(wrong.keys().next().value); };
  /** The entry whose hash is the code's; every entry is compared (constant work for a known and an unknown code). */
  function match(code) {
    const h = sha(normCode(code));
    let hit = null;
    for (const v of list) if (timingSafeEqual(h, v.hash) && !hit) hit = v;
    return hit;
  }

  /** acct: the pot key of the login account (lib/duell-ai.mjs who().acct). ip: shared.clientKey(req) or null. */
  function redeem(acct, ip, code) {
    if (!list.length || !credit || (credit.broken && credit.broken())) return { status: 503, body: { ok: false, error: 'off' } };
    if (!acct) return { status: 401, body: { ok: false, error: 'login' } };
    const ka = 'a:' + acct, ki = ip ? 'i:' + ip : '';
    if (tries(ka) >= triesMax || tries(ki) >= triesMax) { log({ event: 'duell-voucher', ok: false, why: 'tries' }); return { status: 429, body: { ok: false, error: 'limit' } }; }
    const c = typeof code === 'string' ? normCode(code) : '';
    const v = c.length >= 4 && c.length <= 64 ? match(c) : null;
    if (!v) { miss(ka); miss(ki); log({ event: 'duell-voucher', ok: false, why: 'unknown' }); return { status: 403, body: { ok: false, error: 'unknown' } }; }
    const h8 = v.tag.slice(0, 8), dayStart = Math.floor(now() / DAY) * DAY;
    const mine = credit.granted(v.tag, { key: acct, since: v.reusable ? dayStart : 0 });
    if ((v.reusable ? mine >= v.perAcct : mine >= 1) || credit.granted(v.tag, { since: dayStart }) >= v.global) {
      log({ event: 'duell-voucher', ok: false, why: 'limit', h: h8 });
      return { status: 429, body: { ok: false, error: 'limit' } };
    }
    const added = credit.grant(acct, v.amount, 'voucher', v.tag);
    if (!added) return { status: 503, body: { ok: false, error: 'off' } };
    log({ event: 'duell-voucher', ok: true, h: h8, added });
    return { status: 200, body: { ok: true, added, credit: credit.available(acct) } };
  }

  async function route(req, res, url) {
    if (url.pathname !== '/api/duell/credit/redeem') return false;
    const { cors, json } = await shared.readJson(req, res, 'POST, OPTIONS', 2048);
    if (json === undefined) return true;
    const send = (r) => shared.send(res, r.status, r.body, cors.headers);
    if (!list.length) { send({ status: 503, body: { ok: false, error: 'off' } }); return true; }
    const p = await who(req, {});
    if (p.status === 503) { send({ status: 503, body: { ok: false, error: 'off' } }); return true; }
    const acct = p && !p.error && p.account ? p.acct : '';
    send(redeem(acct, shared.clientKey(req), json && typeof json === 'object' ? json.code : undefined));
    return true;
  }
  return { route, redeem, on: () => list.length > 0, _wrong: wrong };
}
