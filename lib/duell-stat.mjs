// My Daily Idea, card statistics: how often a card is shared, remixed, opened, and thumbs up/down.
//   POST /api/duell/stat  {i, e: share|open|vote, w?, v?}   -> 204 (400 bad body, 413 > 1 KB, 429 rate limit);
//                         not counted: 204 with X-Stat: same | dup | full | login | unavailable
//   GET  /api/duell/stat?days=7|30|90|365                   -> {days, cards:[{i, share, remix, open, up, down, w}]}
// Sparse by design: no device id, no cookie of our own, no IP on disk. Dedupe uses an HMAC under a salt that lives only
// in memory and changes every UTC day. The file holds only counters; every value below K comes out as null (k-anonymity).
//
// Votes count only with a verified bunsenbrenner account: the identity is what the wrapper itself reads from the gate
// (lib/auth.mjs, the gate checks the session cookie), never a header of the client. Without an account the answer is
// 204 with `X-Stat: login` and nothing is counted. The current vote of every (account, card) is kept for good in
// votes.json under HMAC(DUELL_STAT_SALT, account|i) -> 1 | -1; nothing the client says about an earlier vote is used.
// up/down change only by the difference old -> new, and the day bucket gets exactly that difference (it may be
// negative), so the sum over all days is exact. At most VOTE_CHANGES changes per account, card and day. No salt, no votes.
// open and share count without an account too, deduped per client where the client is known; unknown clients share
// one tight overall limit, so those numbers are coarse.
import { createHmac, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const STAT_BODY_MAX = 1024;
export const K = 5;
export const KEEP_DAYS = 400;
export const WINDOWS = [7, 30, 90, 365];   // the only ranges GET answers: no sliding window to diff out small values
export const DAILY_DAYS = 90;     // older days are folded into month sums
// apps/duell-web/src/daily.js (marketplace), AREAS
export const AREAS = ['text', 'farbe', 'stil', 'sticker', 'foto', 'beat', 'stimme', 'regeln', 'figur', 'welt', 'idee'];
const AREA_SET = new Set(AREAS);
const FIELDS = ['share', 'remix', 'open', 'up', 'down'];
const EVENTS = new Set(['share', 'open', 'vote']);
const ID = /^[a-z0-9-]{1,32}$/;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/, MONTH_KEY = /^\d{4}-\d{2}$/;
const VOTES = new Set([1, -1, 0]);
export const VOTE_CHANGES = 3;    // per account, card and day
const DAY_MS = 86400000;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d) => Date.parse(d + 'T00:00:00Z');
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return isoDay(Date.UTC(y, mo, 0)); };   // last day of month m

/** Validates the POST body. Returns {i, e, w, v} or null. Unknown areas are ignored, fields of other events too, and `p` always. */
export function parseEvent(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const { i, e } = b;
  if (typeof i !== 'string' || !ID.test(i) || !EVENTS.has(e)) return null;
  let w = [];
  if (e === 'share' && b.w !== undefined) {
    if (!Array.isArray(b.w) || b.w.length > 32) return null;
    w = [...new Set(b.w.filter((x) => typeof x === 'string' && AREA_SET.has(x)))];
  }
  let v = 0;
  if (e === 'vote') { if (!VOTES.has(b.v)) return null; v = b.v; }
  return { i, e, w, v };
}

const emptyCard = () => { const c = Object.create(null); for (const f of FIELDS) c[f] = 0; c.w = Object.create(null); return c; };
const cleanN = (n) => (Number.isInteger(n) && n > 0 ? n : 0);
const cleanZ = (n) => (Number.isInteger(n) && Math.abs(n) < 1e9 ? n : 0);   // up/down are differences, they may be negative
function cleanCard(c) {
  if (!c || typeof c !== 'object') return null;
  const o = emptyCard();
  for (const f of FIELDS) o[f] = f === 'up' || f === 'down' ? cleanZ(c[f]) : cleanN(c[f]);
  if (c.w && typeof c.w === 'object') for (const a of AREAS) if (hasOwn(c.w, a) && cleanN(c.w[a])) o.w[a] = cleanN(c.w[a]);
  return o;
}
function addInto(dst, c) {
  for (const f of FIELDS) dst[f] += c[f];
  for (const a of Object.keys(c.w)) dst.w[a] = (dst.w[a] || 0) + c.w[a];
}
const weight = (c) => c.share + c.open + Math.abs(c.up) + Math.abs(c.down);

/** Only known keys and numbers survive; every object is prototype-free. */
export function cleanBuckets(j) {
  const out = Object.create(null);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return out;
  for (const d of Object.keys(j)) {
    if (!(DAY_KEY.test(d) || MONTH_KEY.test(d)) || !j[d] || typeof j[d] !== 'object') continue;
    const b = Object.create(null);
    for (const i of Object.keys(j[d])) { if (!ID.test(i)) continue; const c = cleanCard(j[d][i]); if (c) b[i] = c; }
    out[d] = b;
  }
  return out;
}

/**
 * Folds days older than DAILY_DAYS into month sums ("YYYY-MM", at most cardsMax cards each, the busiest kept) and drops
 * everything older than KEEP_DAYS. Bounded memory: DAILY_DAYS day buckets plus about 11 month buckets of cardsMax.
 */
export function compact(buckets, today, cardsMax = 2000) {
  const t = dayMs(today), keepFrom = isoDay(t - (KEEP_DAYS - 1) * DAY_MS), dailyFrom = isoDay(t - (DAILY_DAYS - 1) * DAY_MS);
  for (const d of Object.keys(buckets)) {
    if (MONTH_KEY.test(d)) { if (monthEnd(d) < keepFrom) delete buckets[d]; continue; }
    if (d < keepFrom) { delete buckets[d]; continue; }
    if (d >= dailyFrom) continue;
    const m = d.slice(0, 7), mb = hasOwn(buckets, m) ? buckets[m] : (buckets[m] = Object.create(null));
    for (const i of Object.keys(buckets[d])) { if (!hasOwn(mb, i)) mb[i] = emptyCard(); addInto(mb[i], buckets[d][i]); }
    delete buckets[d];
    const ids = Object.keys(mb);
    if (ids.length > cardsMax) for (const i of ids.sort((a, b) => weight(mb[a]) - weight(mb[b])).slice(0, ids.length - cardsMax)) delete mb[i];
  }
  return buckets;
}

/**
 * Sums the last `days` UTC days up to `today` and applies the k-threshold. Days older than DAILY_DAYS exist only as
 * month sums: a month counts when it reaches into the range, so a long range starts on a month boundary.
 * Sorted by the masked share (null as 0, small values do not leak through the order), then by id.
 */
export function summarize(buckets, today, days, k = K) {
  const from = isoDay(dayMs(today) - (days - 1) * DAY_MS), sum = new Map();
  for (const d of Object.keys(buckets)) {
    const inRange = DAY_KEY.test(d) ? d >= from && d <= today : MONTH_KEY.test(d) && monthEnd(d) >= from;
    if (!inRange) continue;
    for (const i of Object.keys(buckets[d])) { if (!sum.has(i)) sum.set(i, emptyCard()); addInto(sum.get(i), buckets[d][i]); }
  }
  const mask = (n) => (n >= k ? n : null);
  const cards = [...sum.entries()].map(([i, s]) => ({
    i, share: mask(s.share), remix: mask(s.remix), open: mask(s.open), up: mask(s.up), down: mask(s.down),
    w: Object.fromEntries(Object.keys(s.w).filter((a) => s.w[a] >= k).map((a) => [a, s.w[a]])),   // below k: left out
  }));
  cards.sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0));
  return { days, cards };
}

/** Fixed one-minute windows per key; over `max` keys the oldest entries go first. */
export function createLimiter(perMin, { now, max = 10000 }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    let h = hits.get(key);
    if (!h || t - h.start >= 60000) {
      h = { start: t, n: 0 };
      hits.delete(key); hits.set(key, h);        // re-insert: Map order is then the order of the windows
      while (hits.size > max) hits.delete(hits.keys().next().value);
    }
    return ++h.n > perMin;
  };
}

export function createStats({ env = process.env, shared, auth, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)), debounceMs = 5000 } = {}) {
  const aiFile = env.DUELL_AI_STATE_FILE || '';
  const cfg = {
    // next to state.json on the duell-ai volume unless set; without either the statistics live in memory only
    file: env.DUELL_STAT_FILE ?? (aiFile ? join(dirname(aiFile), 'stat.json') : ''),
    votesMax: num(env.DUELL_STAT_VOTES_MAX, 500000),
    postPerMin: num(env.DUELL_STAT_POST_PER_MIN, 60),
    getPerMin: num(env.DUELL_STAT_GET_PER_MIN, 30),
    anonReqPerMin: num(env.DUELL_STAT_ANON_REQ_PER_MIN, 600),   // requests of all unknown clients together
    anonPerMin: num(env.DUELL_STAT_ANON_PER_MIN, 20),           // counted open/share of all unknown clients together
    anonPerDay: num(env.DUELL_STAT_ANON_PER_DAY, 1000),
    cardsMax: num(env.DUELL_STAT_CARDS_MAX, 2000),
    seenMax: num(env.DUELL_STAT_SEEN_MAX, 200000),
    cacheMs: num(env.DUELL_STAT_CACHE_MS, 60000),
  };
  cfg.votesFile = env.DUELL_STAT_VOTES_FILE ?? (cfg.file ? join(dirname(cfg.file), 'votes.json') : '');
  const voteSalt = env.DUELL_STAT_SALT || '';   // durable; never logged, never sent
  const canLogin = !!(auth && auth.mode === 'gate');
  const day = () => isoDay(now());
  // Reads a JSON file; an unreadable one is kept for a look by hand (.bad-<ms>), never overwritten.
  const writable = new Map();
  function load(file, what) {
    writable.set(file, !!file);
    if (!file || !existsSync(file)) return null;
    try { return JSON.parse(readFileSync(file, 'utf8')); }
    catch {
      const bad = `${file}.bad-${now()}`;
      try { renameSync(file, bad); log({ event: 'duell-stat-store', ok: false, file: what, why: 'unreadable', kept: bad }); }
      catch { writable.set(file, false); log({ event: 'duell-stat-store', ok: false, file: what, why: 'unreadable, not moved: not writing' }); }
      return null;
    }
  }
  let buckets = cleanBuckets(load(cfg.file, 'stat'));
  if (!cfg.file) log({ event: 'duell-stat-config', note: 'no DUELL_STAT_FILE / DUELL_AI_STATE_FILE: card statistics restart with the process' });
  const votes = new Map();   // HMAC(salt, account|i) -> 1 | -1; nothing else
  { const j = load(cfg.votesFile, 'votes'); if (j && typeof j === 'object' && !Array.isArray(j)) for (const k of Object.keys(j)) if (/^[A-Za-z0-9_-]{43}$/.test(k) && (j[k] === 1 || j[k] === -1)) votes.set(k, j[k]); }
  if (!voteSalt) log({ event: 'duell-stat-config', note: 'DUELL_STAT_SALT missing: votes are not counted' });
  const voteKey = (account, i) => createHmac('sha256', voteSalt).update(account + '|' + i).digest('base64url');

  // ---- per-day salt and dedupe, memory only --------------------------------------------------------
  const daily = { day: '', salt: null, seen: new Map(), anon: 0 };   // seen: HMAC -> open/share count | {n, v} for votes
  const rotate = () => {
    const d = day();
    if (daily.day === d) return;
    daily.day = d; daily.salt = randomBytes(32); daily.seen = new Map(); daily.anon = 0;
    compact(buckets, d, cfg.cardsMax);
  };
  const tag = (who, i, e) => createHmac('sha256', daily.salt).update(`${who}\u0000${i}\u0000${e}`).digest('base64url').slice(0, 22);
  const postLimited = createLimiter(cfg.postPerMin, { now }), getLimited = createLimiter(cfg.getPerMin, { now });
  const anonReqLimited = createLimiter(cfg.anonReqPerMin, { now }), anonCountLimited = createLimiter(cfg.anonPerMin, { now });

  // ---- storage --------------------------------------------------------------------------------------
  let timer = null;
  function writeAtomic(file, data, what) {
    if (!file || !writable.get(file)) return;
    const tmp = file + '.tmp';
    try {
      mkdirSync(dirname(file), { recursive: true });
      const fd = openSync(tmp, 'w');
      try { writeSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, file);
    } catch { log({ event: 'duell-stat-store', ok: false, file: what, why: 'unwritable' }); }
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    writeAtomic(cfg.votesFile, Object.fromEntries(votes), 'votes');
    writeAtomic(cfg.file, buckets, 'stat');
  }
  function dirty() {   // the public GET cache is NOT cleared here: it holds 60 s, so a single vote does not show at once
    if (!(cfg.file || cfg.votesFile) || timer) return;
    timer = setTimeout(flush, debounceMs);
    if (timer.unref) timer.unref();
  }
  function card(i) {
    const b = hasOwn(buckets, daily.day) ? buckets[daily.day] : (buckets[daily.day] = Object.create(null));
    if (hasOwn(b, i)) return b[i];
    if (Object.keys(b).length >= cfg.cardsMax) return null;   // random ids must not grow the file without end
    return (b[i] = emptyCard());
  }
  const roomFor = (t) => daily.seen.has(t) || daily.seen.size < cfg.seenMax;   // memory bound: fail closed, never count twice

  /**
   * Counts one valid event. who: { account } (verified email, lowercased) and/or { client } (clientKey) or {}.
   * Returns 'ok' | 'same' (this vote is already stored) | 'dup' (duplicate open/share, or a 4th vote change today) | 'full' (limit or memory bound) | 'login' (vote without
   * account) | 'unavailable' (gate unreachable, or no DUELL_STAT_SALT).
   */
  function record(ev, who = {}) {
    rotate();
    if (ev.e === 'vote') {
      if (who.unavailable || !voteSalt) return 'unavailable';
      if (!who.account) return 'login';
      const vk = voteKey(who.account, ev.i), old = votes.get(vk) || 0;
      if (ev.v === old) return 'same';                       // already stored (e.g. from a second device): no change, not a change of today
      const t = tag('a:' + who.account, ev.i, 'vote'), n = daily.seen.get(t) || 0;
      if (n >= VOTE_CHANGES) return 'dup';
      if (!roomFor(t) || (!old && votes.size >= cfg.votesMax)) return 'full';
      const c = card(ev.i);
      if (!c) return 'full';
      daily.seen.set(t, n + 1);
      if (ev.v) votes.set(vk, ev.v); else votes.delete(vk);
      if (old === 1) c.up--; else if (old === -1) c.down--;  // the difference old -> new, nothing else
      if (ev.v === 1) c.up++; else if (ev.v === -1) c.down++;
      dirty(); return 'ok';
    }
    const key = who.client ? 'c:' + who.client : who.account ? 'a:' + who.account : null;
    let t = null;
    if (key) {
      t = tag(key, ev.i, ev.e);
      if (daily.seen.get(t)) return 'dup';
      if (!roomFor(t)) return 'full';
    } else if (daily.anon >= cfg.anonPerDay || anonCountLimited('anon')) return 'full';
    const c = card(ev.i);
    if (!c) return 'full';
    if (t) daily.seen.set(t, 1); else daily.anon++;
    if (ev.e === 'open') c.open++;
    else {
      c.share++;
      if (ev.w.length) { c.remix++; for (const a of ev.w) c.w[a] = (c.w[a] || 0) + 1; }
    }
    dirty(); return 'ok';
  }

  const cache = new Map();   // days -> { at, body }
  function read(days) {
    rotate();
    const hit = cache.get(days);
    if (hit && now() - hit.at < cfg.cacheMs) return hit.body;
    const body = summarize(buckets, daily.day, days);
    cache.set(days, { at: now(), body });
    return body;
  }

  /**
   * For the reviewer view (/duell/pruefen, tab "Statistik"; route and admin token live there): the same shape as read(),
   * {days, cards}, without the k-mask, so also small and negative numbers (up/down are differences). Only the fixed
   * windows; anything else -> null. Counters only: never anything from votes.json. Not cached.
   */
  function readAdmin(days) {
    if (!WINDOWS.includes(days)) return null;
    rotate();
    return summarize(buckets, daily.day, days, -Infinity);
  }

  // ---- HTTP -----------------------------------------------------------------------------------------
  // Origin "null" (file:, iOS shells) may POST here without credentials: ACAO "*", never Allow-Credentials. Fine,
  // because the POST returns no data; the cookie of such a request is not read. Everything else: CORS of /api/duell.
  const corsOf = (req) => (req.headers.origin === 'null' ? { ok: true, nullOrigin: true, headers: { 'Access-Control-Allow-Origin': '*' } } : { ...shared.corsFor(req), nullOrigin: false });
  function readBody(req, max) {
    return new Promise((resolve) => {
      const chunks = []; let size = 0, big = false;
      req.on('data', (c) => { size += c.length; if (size > max) big = true; else chunks.push(c); });
      req.on('end', () => { if (big) return resolve({ big: true }); try { resolve({ json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { resolve({ bad: true }); } });
      req.on('error', () => resolve({ bad: true }));
    });
  }
  const EXPOSE = { 'Access-Control-Expose-Headers': 'X-Stat' };
  const done = (res, cors, extra = {}) => res.writeHead(204, { 'Cache-Control': 'no-store', ...cors.headers, ...EXPOSE, ...extra }).end();

  async function route(req, res, url) {
    if (url.pathname !== '/api/duell/stat') return false;
    const m = req.method;
    if (m === 'GET' || m === 'HEAD') {
      req.resume();
      const cors = shared.corsFor(req);   // reading: no "null" exception
      if (!cors.ok) { shared.send(res, 403, { error: 'origin' }, cors.headers); return true; }
      const ck = shared.clientKey(req);
      if (ck ? getLimited('g:' + ck) : anonReqLimited('g')) { shared.send(res, 429, { error: 'rate-limited' }, { ...cors.headers, 'Retry-After': '60' }); return true; }
      const raw = url.searchParams.get('days'), days = raw === null ? 30 : Number(raw);
      if (!WINDOWS.includes(days)) { shared.send(res, 400, { error: 'bad-days', allowed: WINDOWS }, cors.headers); return true; }
      shared.send(res, 200, read(days), { ...cors.headers, 'Cache-Control': `public, max-age=${Math.round(cfg.cacheMs / 1000)}` }); return true;
    }
    const cors = corsOf(req);
    if (!cors.ok) { req.resume(); shared.send(res, 403, { error: 'origin' }, cors.headers); return true; }
    if (m === 'OPTIONS') {
      req.resume();
      const h = cors.headers['Access-Control-Allow-Origin']
        ? { ...cors.headers, 'Access-Control-Allow-Methods': cors.nullOrigin ? 'POST' : 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } : {};
      res.writeHead(204, h).end(); return true;
    }
    if (m !== 'POST') { req.resume(); shared.send(res, 405, { error: 'method' }, { ...cors.headers, Allow: 'GET, POST, OPTIONS' }); return true; }
    if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') { req.resume(); shared.send(res, 415, { error: 'bad-media' }, cors.headers); return true; }
    if (Number(req.headers['content-length']) > STAT_BODY_MAX) { req.resume(); shared.send(res, 413, { error: 'too-large' }, cors.headers); return true; }
    const b = await readBody(req, STAT_BODY_MAX);
    if (b.big) { shared.send(res, 413, { error: 'too-large' }, cors.headers); return true; }
    const ck = shared.clientKey(req);
    if (ck ? postLimited('p:' + ck) : anonReqLimited('p')) { shared.send(res, 429, { error: 'rate-limited' }, { ...cors.headers, 'Retry-After': '60' }); return true; }
    const ev = b.bad ? null : parseEvent(b.json);
    if (!ev) { shared.send(res, 400, { error: 'bad-request' }, cors.headers); return true; }
    // The account only where it is needed (a vote) or no client key exists; never for a "null" origin (no credentials).
    let account = '', unavailable = false;
    if (canLogin && !cors.nullOrigin && (ev.e === 'vote' || !ck) && auth.sessionCookie(req)) {
      const id = await auth.identify(req);
      if (id.email) account = id.email.toLowerCase(); else if (id.error) unavailable = true;
    }
    const r = record(ev, { client: ck, account, unavailable: unavailable && ev.e === 'vote' });
    done(res, cors, r === 'ok' ? {} : { 'X-Stat': r });
    return true;
  }

  return { route, record, read, readAdmin, flush, cfg, _buckets: () => buckets, _votes: () => votes };
}
