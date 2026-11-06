// My Daily Idea, card statistics: how often a card is shared, remixed, opened, and thumbs up/down.
//   POST /api/duell/stat  {i, e: share|open|vote, w?, v?, p?}   -> 204 (400 on a bad body, 429 over the rate limit)
//   GET  /api/duell/stat?days=30                                -> {days, cards:[{i, share, remix, open, up, down, w}]}
// Sparse by design: no device id, no cookie, no IP on disk. Dedupe uses an HMAC of a salt that lives only in memory
// and changes every UTC day, over clientKey(req) (itself an HMAC of the IP), the card and the event. The file holds
// only day buckets of counters; every value below K comes out as null (k-anonymity).
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const STAT_BODY_MAX = 1024;
export const K = 5;
export const KEEP_DAYS = 400;
export const AREAS = ['text', 'sticker', 'farbe', 'stil', 'foto', 'figur', 'welt', 'regeln'];
const EVENTS = new Set(['share', 'open', 'vote']);
const ID = /^[a-z0-9-]{1,32}$/;
const VOTES = new Set([1, -1, 0]);
const VOTE_CHANGES = 3;          // per day, card and client
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
const DAY_MS = 86400000;

/** Validates the POST body. Returns {i, e, w, v, p} or null. */
export function parseEvent(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const { i, e } = b;
  if (typeof i !== 'string' || !ID.test(i) || !EVENTS.has(e)) return null;
  let w = [];
  if (b.w !== undefined) {
    if (e !== 'share' || !Array.isArray(b.w) || b.w.length > AREAS.length * 2 || !b.w.every((x) => AREAS.includes(x))) return null;
    w = [...new Set(b.w)];
  }
  let v = 0, p = 0;
  if (e === 'vote') {
    if (!VOTES.has(b.v) || (b.p !== undefined && !VOTES.has(b.p))) return null;
    v = b.v; p = b.p ?? 0;
  } else if (b.v !== undefined || b.p !== undefined) return null;
  return { i, e, w, v, p };
}

const emptyCard = () => ({ share: 0, remix: 0, open: 0, up: 0, down: 0, w: {} });

/** Sums the last `days` UTC days up to `today` and applies the k-threshold. Sorted by share (masked), then id. */
export function summarize(buckets, today, days, k = K) {
  const t0 = Date.parse(today + 'T00:00:00Z'), sum = new Map();
  for (let d = 0; d < days; d++) {
    const b = buckets[new Date(t0 - d * DAY_MS).toISOString().slice(0, 10)];
    if (!b) continue;
    for (const [i, c] of Object.entries(b)) {
      const s = sum.get(i) || emptyCard(); sum.set(i, s);
      for (const f of ['share', 'remix', 'open', 'up', 'down']) s[f] += c[f] || 0;
      for (const [a, n] of Object.entries(c.w || {})) s.w[a] = (s.w[a] || 0) + n;
    }
  }
  const mask = (n) => (n >= k ? n : null);
  const cards = [...sum.entries()].map(([i, s]) => ({
    i, share: mask(s.share), remix: mask(s.remix), open: mask(s.open), up: mask(s.up), down: mask(s.down),
    w: Object.fromEntries(Object.entries(s.w).map(([a, n]) => [a, mask(n)])),
  }));
  cards.sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0));
  return { days, cards };
}

export function createStats({ env = process.env, shared, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)), debounceMs = 5000 } = {}) {
  const aiFile = env.DUELL_AI_STATE_FILE || '';
  const cfg = {
    // next to state.json on the duell-ai volume unless set; without either the statistics live in memory only
    file: env.DUELL_STAT_FILE ?? (aiFile ? join(dirname(aiFile), 'stat.json') : ''),
    perMin: num(env.DUELL_STAT_PER_MIN, 60),
    anonPerMin: num(env.DUELL_STAT_ANON_PER_MIN, 600),
    cardsMax: num(env.DUELL_STAT_CARDS_MAX, 2000),
    seenMax: num(env.DUELL_STAT_SEEN_MAX, 200000),
  };
  const day = () => new Date(now()).toISOString().slice(0, 10);
  let buckets = {};
  if (cfg.file) {
    try { if (existsSync(cfg.file)) { const j = JSON.parse(readFileSync(cfg.file, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) buckets = j; } }
    catch { log({ event: 'duell-stat-store', ok: false, why: 'unreadable' }); }
  } else log({ event: 'duell-stat-config', note: 'no DUELL_STAT_FILE / DUELL_AI_STATE_FILE: card statistics restart with the process' });

  // ---- per-day salt and dedupe, memory only --------------------------------------------------------
  const daily = { day: '', salt: null, seen: new Map() };   // HMAC -> number of counted events today
  const rotate = () => {
    const d = day();
    if (daily.day === d) return;
    daily.day = d; daily.salt = randomBytes(32); daily.seen = new Map();
    prune();
  };
  const tag = (ck, i, e) => createHmac('sha256', daily.salt).update(`${ck}\u0000${i}\u0000${e}`).digest('base64url').slice(0, 22);
  let warnedAnon = false;

  // ---- rate limit per client, fixed one-minute window ----------------------------------------------
  const hits = new Map();
  function limited(ck) {
    const key = ck ?? '\u0000anon', t = now(), lim = ck ? cfg.perMin : cfg.anonPerMin;
    let h = hits.get(key);
    if (!h || t - h.start >= 60000) { h = { start: t, n: 0 }; hits.set(key, h); if (hits.size > 10000) { hits.clear(); hits.set(key, h); } }
    return ++h.n > lim;
  }

  // ---- storage --------------------------------------------------------------------------------------
  let timer = null;
  function prune() {
    const cut = new Date(Date.parse(day() + 'T00:00:00Z') - (KEEP_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
    for (const d of Object.keys(buckets)) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < cut) delete buckets[d];
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!cfg.file) return;
    try { mkdirSync(dirname(cfg.file), { recursive: true }); writeFileSync(cfg.file + '.tmp', JSON.stringify(buckets)); renameSync(cfg.file + '.tmp', cfg.file); }
    catch { log({ event: 'duell-stat-store', ok: false, why: 'unwritable' }); }
  }
  function dirty() {
    if (!cfg.file || timer) return;
    timer = setTimeout(flush, debounceMs);
    if (timer.unref) timer.unref();
  }
  function card(i) {
    const b = buckets[daily.day] || (buckets[daily.day] = {});
    if (b[i]) return b[i];
    if (Object.keys(b).length >= cfg.cardsMax) return null;   // random ids must not grow the file without end
    return (b[i] = emptyCard());
  }

  /** Counts one valid event for client key `ck` (null when the IP is unknown). Returns whether anything changed. */
  function record(ev, ck) {
    rotate();
    if (ck == null && !warnedAnon) { warnedAnon = true; log({ event: 'duell-stat-anon', note: 'client unknown (set DUELL_IP_HEADER): no per-client dedupe, shared rate limit only' }); }
    const t = ck == null ? null : tag(ck, ev.i, ev.e), used = t ? daily.seen.get(t) || 0 : 0;
    if (ev.e === 'vote') {
      if (ev.v === ev.p) return false;
      if (t && used >= VOTE_CHANGES) return false;
    } else if (t && used >= 1) return false;
    if (t && !daily.seen.has(t) && daily.seen.size >= cfg.seenMax) return false;   // memory bound: fail closed, never count twice
    const c = card(ev.i);
    if (!c) return false;
    if (t) daily.seen.set(t, used + 1);
    if (ev.e === 'open') c.open++;
    else if (ev.e === 'share') {
      c.share++;
      if (ev.w.length) { c.remix++; for (const a of ev.w) c.w[a] = (c.w[a] || 0) + 1; }
    } else {
      if (ev.p === 1) c.up = Math.max(0, c.up - 1); else if (ev.p === -1) c.down = Math.max(0, c.down - 1);
      if (ev.v === 1) c.up++; else if (ev.v === -1) c.down++;
    }
    dirty();
    return true;
  }

  function read(days) { rotate(); return summarize(buckets, daily.day, days); }

  async function route(req, res, url) {
    if (url.pathname !== '/api/duell/stat') return false;
    if (req.method === 'GET' || req.method === 'HEAD') {
      req.resume();
      const cors = shared.corsFor(req);
      if (!cors.ok) { shared.send(res, 403, { error: 'origin' }, cors.headers); return true; }
      if (limited(shared.clientKey(req))) { shared.send(res, 429, { error: 'rate-limited' }, { ...cors.headers, 'Retry-After': '60' }); return true; }
      const raw = url.searchParams.get('days'), days = raw === null ? 30 : Number(raw);
      if (!Number.isInteger(days) || days < 1 || days > KEEP_DAYS) { shared.send(res, 400, { error: 'bad-days' }, cors.headers); return true; }
      shared.send(res, 200, read(days), cors.headers); return true;
    }
    const { cors, json } = await shared.readJson(req, res, 'GET, POST, OPTIONS', STAT_BODY_MAX);
    if (json === undefined) return true;
    const ck = shared.clientKey(req);
    if (limited(ck)) { shared.send(res, 429, { error: 'rate-limited' }, { ...cors.headers, 'Retry-After': '60' }); return true; }
    const ev = parseEvent(json);
    if (!ev) { shared.send(res, 400, { error: 'bad-request' }, cors.headers); return true; }
    record(ev, ck);
    res.writeHead(204, { 'Cache-Control': 'no-store', ...cors.headers }).end();
    return true;
  }

  return { route, record, read, flush, cfg, _buckets: () => buckets };
}
