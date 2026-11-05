// My Daily Idea: the unit "AI action", the separate pots and the entitlement keys. Pure functions, no state.
//
// Unit: an answer costs by its length in output tokens: <= 300 -> 1, <= 900 -> 2, longer -> 3; a meeting protocol always 3,
// a quiz at least 2.
// A cached answer costs 0. Pots, each with its own period:
//   free      7 a week (Monday 00:00 UTC) per device or login account                DUELL_AI_FREE_PER_WEEK
//   pro       300 a month per Pro key, shared by at most 6 devices                     DUELL_AI_PRO_PER_MONTH, DUELL_AI_PRO_DEVICES
//   business  300 a month per team key, plus a reserved share of the model's day       DUELL_AI_BIZ_PER_MONTH, DUELL_AI_BIZ_RESERVED_PER_DAY
//   trial     protocols without a team key: 3 a month per device (one protocol), never the youth counter   DUELL_PROTOKOLL_TRIAL_PER_MONTH
//
// Entitlement is server configuration only (there is no purchase here): a key is
//   "mdi1.<pro|biz>.<id>.<HMAC-SHA256(DUELL_ENTITLEMENT_SECRET, 'mdi1.<tier>.<id>'), base64url, 22 chars>"
// and counts only while it is listed in DUELL_ENTITLEMENTS (comma separated). Taking it off the list revokes it; a key that is
// listed but not signed with the secret (a typo, a guess) counts as nothing. bin/duell-key.mjs mints keys.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const KEY_RE = /^mdi1\.(pro|biz)\.([a-z0-9-]{3,32})\.([A-Za-z0-9_-]{22})$/;

/** Units for one answer. outTokens: completion tokens as the model reported them (or an estimate). */
export function costOf(kind, outTokens) {
  if (kind === 'protokoll') return 3;
  const n = Number(outTokens) || 0, c = n <= 300 ? 1 : n <= 900 ? 2 : 3;
  return kind === 'quiz' ? Math.max(2, c) : c;   // a question set is 2 at least (KI-Konzept: Lernpaket, Gruppen-, Team-Quiz)
}
/** When the model does not report usage: ~3.5 characters per token for German/English JSON. */
export const estimateTokens = (text) => Math.ceil(String(text || '').length / 3.5);

const DAY = 86400000;
/** ISO week id ("2026-W45") of a time, and the start of the next week (Monday 00:00 UTC). */
export function weekOf(t) {
  const d = new Date(Math.floor(t / DAY) * DAY), wd = (d.getUTCDay() + 6) % 7;        // Monday = 0
  const monday = d.getTime() - wd * DAY, thursday = new Date(monday + 3 * DAY);
  const y = thursday.getUTCFullYear(), jan4 = Date.UTC(y, 0, 4), w1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  const n = 1 + Math.round((monday - w1) / (7 * DAY));
  return { id: `${y}-W${String(n).padStart(2, '0')}`, next: monday + 7 * DAY };
}
export function monthOf(t) {
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth();
  return { id: `${y}-${String(m + 1).padStart(2, '0')}`, next: Date.UTC(y, m + 1, 1) };
}

const sign = (secret, tier, id) => createHmac('sha256', String(secret)).update(`mdi1.${tier}.${id}`).digest('base64url').slice(0, 22);
/** A new key for the list (bin/duell-key.mjs). */
export function mintKey(secret, tier, id) {
  if (!secret) throw new Error('secret missing');
  if (!/^(pro|biz)$/.test(tier) || !/^[a-z0-9-]{3,32}$/.test(id)) throw new Error('tier pro|biz, id [a-z0-9-]{3,32}');
  return `mdi1.${tier}.${id}.${sign(secret, tier, id)}`;
}
/** The valid keys of the environment: Map key -> { tier: 'pro'|'business', id }. Bad entries are counted, never used. */
export function loadEntitlements(env) {
  const secret = env.DUELL_ENTITLEMENT_SECRET || '', map = new Map();
  let bad = 0;
  for (const k of String(env.DUELL_ENTITLEMENTS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = k.match(KEY_RE);
    const ok = m && secret && (() => { const a = Buffer.from(sign(secret, m[1], m[2])), b = Buffer.from(m[3]); return a.length === b.length && timingSafeEqual(a, b); })();
    if (ok) map.set(k, { tier: m[1] === 'biz' ? 'business' : 'pro', id: m[2] }); else bad++;
  }
  return { map, bad, secret: !!secret };
}
