// My Daily Idea, data cards: one thin proxy for free web APIs (lib/duell-facts-sources.mjs lists them).
//
//   POST /api/duell/ai/fact { api, date, q?, lang? } -> { api, date, h, v?, c?, a?, r?, src }
//
// Like the weather card: no model, no allowance, no person. Only the API name, the day and an optional short word or
// place go out from our server, never the visitor's address. Keys stay here (env), the page never sees one.
// Every answer is cut to fixed fields and lengths and passes the word filter; whatever does not fit is dropped.
// Same day, same answer for everyone: a list is ordered by a hash of api and day, never by Math.random.
// On a failure the page gets the last real answer of the past week, marked stale with its own date, or an error.
// It never shows invented data.
import { createHash } from 'node:crypto';
import { isUnfit, hasContact } from './duell-ai.mjs';
import { SOURCES } from './duell-facts-sources.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const UA = 'MyDailyIdea/1.0 (+https://demos-34a13a96.bunsenbrenner.org/duell)';
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
export const clean = (v, max) => [...String(v ?? '').normalize('NFKC').replace(/[\p{Cc}\p{Cf}<>]/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
export const seedOf = (s) => createHash('sha256').update(s).digest().readUInt32BE(0);
const fits = (s) => !s || (!isUnfit(s) && !hasContact(s));
// Strip and reveal lines come from our own templates; their grouped figures (12.691, 1.659.000) are numbers, not phones.
const fitsLine = (s) => fits(s && s.replace(/\d{1,3}(?:[.,\u202f\u00a0 ]\d{3})+(?![\d])/g, '#'));

// An item from an adapter -> the fixed answer shape, or null if anything is off.
export function shape(it) {
  if (!it || typeof it !== 'object') return null;
  const h = clean(it.h, 90), v = clean(it.v, 90);
  if (!h) return null;
  const out = { h };
  if (v) out.v = v;
  if (it.c !== undefined) {
    if (!Array.isArray(it.c) || it.c.length < 2 || it.c.length > 4) return null;
    const c = it.c.map((x) => clean(x, 40));
    if (c.some((x) => !x) || new Set(c.map((x) => x.toLowerCase())).size !== c.length) return null;
    if (!Number.isInteger(it.a) || it.a < 0 || it.a >= c.length) return null;
    out.c = c; out.a = it.a;
    const r = clean(it.r, 60); if (r) out.r = r;
  }
  return [out.h, ...(out.c || [])].every(fits) && [out.v, out.r].every(fitsLine) ? out : null;
}

export function createFacts({ env = process.env, fetchImpl = fetch, now = () => Date.now(), timeoutMs = 6000, sources = SOURCES } = {}) {
  const perHour = num(env.DUELL_FACTS_IP_PER_HOUR, 60), dailyMax = num(env.DUELL_FACTS_DAILY_MAX, 300);
  const cache = new Map(), hits = new Map(), daily = new Map(), last = new Map();
  const getJson = async (url, headers = {}) => {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
    if (!r.ok) throw Object.assign(new Error('facts-http-' + r.status), { status: r.status });
    return r.json();
  };
  async function get(input, who) {
    const api = String(input && input.api || ''), src = Object.hasOwn(sources, api) ? sources[api] : null, date = String(input && input.date || ''), lang = input && input.lang === 'en' ? 'en' : 'de';
    if (!src || !DATE.test(date)) return { status: 400, body: { error: 'bad-request' } };
    const t = now(), off = (Date.parse(date + 'T00:00:00Z') - Date.parse(new Date(t).toISOString().slice(0, 10) + 'T00:00:00Z')) / DAY;
    if (!(off >= -1 && off <= 1)) return { status: 422, body: { error: 'date-range' } };   // the visitor's day, whatever their time zone
    let q = '';
    if (src.input) {
      q = clean(input.q, src.input.max);
      if (!q || !src.input.re.test(q)) return { status: 400, body: { error: 'bad-request' } };
      if (!fits(q)) return { status: 422, body: { error: 'blocked' } };
    }
    const key = [api, date, q.toLowerCase(), lang].join('|'), hit = cache.get(key);
    if (hit && t - hit.at < (src.ttlMs ?? 6 * 3600000)) return { status: 200, body: hit.body };
    if (who) {
      const arr = (hits.get(who) || []).filter((x) => t - x < 3600000);
      if (arr.length >= perHour) return { status: 429, body: { error: 'rate-limited' } };
      arr.push(t); hits.set(who, arr); if (hits.size > 5000) hits.clear();
    }
    const today = new Date(t).toISOString().slice(0, 10), d = daily.get(api);
    const used = d && d.day === today ? d.n : 0;
    if (used >= dailyMax) return { status: 429, body: { error: 'daily-limit' } };
    daily.set(api, { day: today, n: used + 1 });
    const k = src.key ? String(env[src.key] || '') : '';
    if (src.key && !k) return { status: 503, body: { error: 'not-configured' } };
    const lastKey = [api, q.toLowerCase(), lang].join('|'), old = last.get(lastKey);
    const down = () => (old && (Date.parse(date) - Date.parse(old.date)) / DAY <= 7 ? { status: 200, body: { ...old, stale: true } } : { status: 503, body: { error: 'unavailable' } });
    let items;
    try { items = await src.fetch({ date, q, lang, key: k, seed: seedOf(api + '|' + date + '|' + q.toLowerCase()), get: getJson }); }
    catch (e) { return e && e.status === 404 ? { status: 404, body: { error: 'no-result' } } : down(); }
    if (!Array.isArray(items)) return down();
    if (!items.length) return { status: 404, body: { error: 'no-result' } };
    const s = seedOf(api + '#' + date);
    for (let i = 0; i < items.length; i++) {
      const out = shape(src.ordered ? items[i] : items[(s + i) % items.length]);
      if (!out) continue;
      const body = { api, date, ...out, src: src.credit };
      cache.set(key, { at: t, body }); if (cache.size > 1000) cache.delete(cache.keys().next().value);
      last.set(lastKey, body); if (last.size > 500) last.delete(last.keys().next().value);
      return { status: 200, body };
    }
    return { status: 503, body: { error: 'unfit' } };
  }
  return { get };
}
