// My Daily Idea: the profile under "Mein Stil" -- style, "Meine Wand" without photos, saved cards, AI device id.
//
//   POST /api/duell/profile/get     { via, code? }                       -> { profile|null, rev, via, age18? }
//   POST /api/duell/profile/put     { via, code?, rev, profile, age16?, age18?, fresh? } -> { rev, via }   409 { rev } when rev is stale
//   POST /api/duell/profile/delete  { via, code? }                       -> { deleted: true }
//
// Deleting leaves an empty marker (revision only, no data) so another linked device does not upload the profile again:
// it reads { gone: true } and unlinks itself. Only a device that links anew (fresh: true) may start the profile again.
//
// Two ways in, chosen by the person (decision in the PR: Art. 8 GDPR, consent from 16 in Germany):
//   * via "account": the bunsenbrenner login (gate cookie, same origin only, checked by lib/auth.mjs against the gate).
//     Only after the page's "I am 16 or older"; the first put must carry age16: true and the day of that statement is
//     kept with the profile. The AI allowance of an account is already the account's (lib/duell-ai.mjs), so no AI field.
//   * via "code": a sync code of 128 random bits made on the device. No e-mail, no name; whoever has the code can read,
//     change and delete the profile. Starting a new one needs a signed-in account (16+, e.g. a parent for a child; the
//     account is not stored with it); syncing an existing one needs none, so the Android shell can join (no cookie there).
//
// What is stored, one file per profile in DUELL_PROFILE_DIR (a volume): an HMAC of the account or code as file name,
// the sanitised profile, a revision and the 16+ day (and the 18+ day, if stated) for accounts. A wall entry kept with Merken also carries its link
// fragment f (c=..., the work's own texts and settings as in a shared link, never a photo). No e-mail, no IP, no code, no photo: wall pictures
// of photo works never get here (the page leaves them out, this file refuses kind "photo"). A profile unused for
// DUELL_PROFILE_TTL_DAYS is deleted (the file name hangs on DUELL_PROFILE_SALT, at least 16 characters and fixed: without it
// the routes answer 503 and everything stays on the device); "delete" removes the file at once.
//
// Everything is injectable (env, clock, auth) so the tests need no network.

import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanEmoji, cleanText } from './duell.mjs';
import { hasContact } from './duell-ai.mjs';

const CODE = /^[a-f0-9]{32}$/;
const ID = /^[a-z0-9-]{1,40}$/;
const KIND = /^[a-z]{1,12}$/;
const HEX = /^#[0-9a-f]{6}$/;
const THUMB = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
// f: the link of a work kept with Merken, only its c= fragment (as the page's daily.js sanitizeWall, C.MAX_FRAGMENT 1200).
const FRAG = /^c=[A-Za-z0-9_-]+={0,2}$/;
export const LIMITS = { body: 640 * 1024, wall: 30, thumb: 30000, saved: 200, nick: 16, fragment: 1200 };
const MB = 1024 * 1024;
const DAY = 86400000, HOUR = 3600000;
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };

/** The profile as it may be stored. Unknown keys and anything out of shape are dropped, never repaired into meaning. */
export function cleanProfile(p, via) {
  p = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  const m = p.me && typeof p.me === 'object' ? p.me : {};
  const nick = typeof m.nick === 'string' && !hasContact(m.nick) ? cleanText(m.nick, LIMITS.nick) : '';
  const colors = Array.isArray(m.colors) && m.colors.length === 2 && m.colors.every((c) => typeof c === 'string' && HEX.test(c.toLowerCase())) ? m.colors.map((c) => c.toLowerCase()) : null;
  const me = { nick, emoji: cleanEmoji(m.emoji) || '', colors, set: typeof m.set === 'string' && KIND.test(m.set) ? m.set : '' };
  const seen = new Set();
  const wall = (Array.isArray(p.wall) ? p.wall : []).filter((e) => e && typeof e === 'object'
    && (ID.test(String(e.id)) || e.id === 'own') && Number.isSafeInteger(e.ts) && e.ts > 0
    && typeof e.k === 'string' && KIND.test(e.k) && e.k !== 'photo'
    && typeof e.th === 'string' && e.th.length <= LIMITS.thumb && THUMB.test(e.th)
    && !seen.has(e.id + ':' + e.ts) && seen.add(e.id + ':' + e.ts)).slice(0, LIMITS.wall).map((e) => {
      const o = { id: e.id, ts: e.ts, k: e.k, th: e.th };
      if (typeof e.f === 'string' && e.f.length <= LIMITS.fragment && FRAG.test(e.f)) o.f = e.f;
      return o;
    });
  const ids = new Set();
  const saved = (Array.isArray(p.saved) ? p.saved : []).filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && ID.test(e.id)
    && Number.isSafeInteger(e.ts) && e.ts > 0 && !ids.has(e.id) && ids.add(e.id)).slice(0, LIMITS.saved).map((e) => ({ id: e.id, ts: e.ts }));
  const out = { v: 1, me, wall, saved };
  if (via === 'code' && p.ai && typeof p.ai === 'object' && CODE.test(String(p.ai.dev))) {
    out.ai = { dev: p.ai.dev };
    if (typeof p.ai.proof === 'string' && /^[0-9a-z]{1,16}$/.test(p.ai.proof)) out.ai.proof = p.ai.proof;
  }
  return out;
}

export function createDuellProfile({ env = process.env, auth, shared, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)) } = {}) {
  const cfg = {
    dir: env.DUELL_PROFILE_DIR || '',
    ttlMs: num(env.DUELL_PROFILE_TTL_DAYS, 400) * DAY,
    max: num(env.DUELL_PROFILE_MAX, 20000),
    newPerHour: num(env.DUELL_PROFILE_NEW_PER_HOUR, 60),
    ipNewPerHour: num(env.DUELL_PROFILE_IP_NEW_PER_HOUR, 5),
    ipNewPerDay: num(env.DUELL_PROFILE_IP_NEW_PER_DAY, 20),
    writesPerHour: num(env.DUELL_PROFILE_WRITES_PER_HOUR, 240),
    // Without a client IP (the tunnel gives none) the limits hang on what the server knows itself: the account and the size.
    accountNewPerDay: num(env.DUELL_PROFILE_ACCOUNT_NEW_PER_DAY, 5),   // new sync-code profiles one account may start a day
    readsPerHour: num(env.DUELL_PROFILE_READS_PER_HOUR, 240),          // get per profile
    deletesPerHour: num(env.DUELL_PROFILE_DELETES_PER_HOUR, 10),       // delete per profile
    profileBytes: num(env.DUELL_PROFILE_MAX_PROFILE_BYTES, 128 * 1024),
    maxBytes: num(env.DUELL_PROFILE_MAX_BYTES, 1024 * MB),
  };
  // Without a fixed salt every restart would rename every file: profiles lost, old files filling the quota. So no salt, no store.
  const salt = String(env.DUELL_PROFILE_SALT || '');
  const saltOk = salt.length >= 16;
  const mac = (s) => createHmac('sha256', salt).update(s).digest('hex').slice(0, 32);
  const canLogin = !!(auth && auth.mode === 'gate');
  let ok = false, count = 0, bytes = 0, nextSweep = 0;
  const writes = new Map(), fresh = new Map(), freshDay = new Map(), reads = new Map(), deletes = new Map(), starts = new Map(), news = { hour: -1, n: 0 };
  const fileOf = (key) => join(cfg.dir, key + '.json');

  /** Profiles nobody opened for ttl days are erased. Runs at most once an hour. */
  function sweep(force) {
    const t = now();
    if (!ok || (!force && t < nextSweep)) return;
    nextSweep = t + HOUR;
    let n = 0, b = 0, names;
    try { names = readdirSync(cfg.dir); } catch (e) { ok = false; log({ event: 'duell-profile-off', why: String(e && e.message || e).slice(0, 120) }); return; }
    for (const f of names) {
      const path = join(cfg.dir, f);
      // a write cut off between the temp file and the rename leaves <key>.json.tmp: gone after an hour
      if (/^[as][a-f0-9]{32}\.json\.tmp$/.test(f)) { try { if (t - statSync(path).mtimeMs > HOUR) unlinkSync(path); } catch { /* gone meanwhile */ } continue; }
      if (!/^[as][a-f0-9]{32}\.json$/.test(f)) continue;
      try { const st = statSync(path); if (t - st.mtimeMs > cfg.ttlMs) { unlinkSync(path); log({ event: 'duell-profile-expired' }); } else { n++; b += st.size; } } catch { /* gone meanwhile */ }
    }
    count = n; bytes = b;
  }
  function load(key) {
    const f = fileOf(key);
    if (!existsSync(f)) return null;
    try { const r = JSON.parse(readFileSync(f, 'utf8')); return r && typeof r.r === 'number' ? r : null; } catch { return null; }
  }
  function touch(key) { const t = new Date(now()); try { utimesSync(fileOf(key), t, t); } catch {} }
  const sizeOf = (key) => { try { return statSync(fileOf(key)).size; } catch { return 0; } };
  function store(key, rec, json = JSON.stringify(rec)) {
    const f = fileOf(key), tmp = f + '.tmp', before = sizeOf(key);
    writeFileSync(tmp, json, { mode: 0o600, flush: true });
    renameSync(tmp, f);
    bytes += Buffer.byteLength(json) - before;
    touch(key);
  }
  // Sliding windows: hits() only reads, hit() counts and then tidies up the others (never the key just counted). Counted
  // are only keys the server knows (an existing profile, a signed-in account, a client IP), so a flood of random codes
  // grows no map and cannot push a real one out.
  const hits = (map, k, t, win) => (map.get(k) || []).filter((x) => t - x < win);
  function hit(map, k, t, win) {
    const a = hits(map, k, t, win); a.push(t); map.set(k, a);
    if (map.size > 5000) for (const [x, v] of map) if (x !== k && !v.some((y) => t - y < win)) map.delete(x);
  }

  if (cfg.dir && !saltOk) log({ event: 'duell-profile-off', why: 'DUELL_PROFILE_SALT missing or shorter than 16 characters' });
  else if (cfg.dir) {
    try { mkdirSync(cfg.dir, { recursive: true, mode: 0o700 }); ok = true; sweep(true); }
    catch (e) { ok = false; log({ event: 'duell-profile-off', why: String(e && e.message || e).slice(0, 120) }); }
  } else log({ event: 'duell-profile-off', why: 'DUELL_PROFILE_DIR not set' });

  // -> { key, via } | { status, body }
  async function who(req, body) {
    if (body.via === 'account') {
      if (!canLogin) return { status: 503, body: { error: 'login-off' } };
      const id = req ? await auth.identify(req) : { email: null };
      if (id.error) return { status: 503, body: { error: 'auth-unavailable' } };
      if (!id.email) return { status: 401, body: { error: 'login-required', login_url: auth.loginUrl('/duell') } };
      return { key: 'a' + mac('account:' + id.email.toLowerCase()), via: 'account' };
    }
    if (body.via === 'code') {
      if (typeof body.code !== 'string' || !CODE.test(body.code)) return { status: 400, body: { error: 'bad-code' } };
      return { key: 's' + mac('code:' + body.code), via: 'code', req };
    }
    return { status: 400, body: { error: 'bad-request' } };
  }

  /** Pure core of the three routes (the tests call it). op: get|put|delete. */
  async function handle(op, body, req, ip) {
    if (!ok) return { status: 503, body: { error: 'storage-off' } };
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: 'bad-request' } };
    const p = await who(req, body);
    if (p.status) return p;
    sweep();
    let rec = load(p.key);
    const t0 = now();
    if ((op === 'get' || op === 'delete') && rec) {   // per profile: a code is no login, so even reading it has a ceiling
      const map = op === 'get' ? reads : deletes;
      if (hits(map, p.key, t0, HOUR).length >= (op === 'get' ? cfg.readsPerHour : cfg.deletesPerHour)) return { status: 429, body: { error: 'rate-limited' }, headers: { 'Retry-After': '600' } };
      hit(map, p.key, t0, HOUR);
    }
    if (op === 'get') {
      if (!rec) return { status: 200, body: { profile: null, rev: 0, via: p.via } };
      touch(p.key);
      if (rec.gone) return { status: 200, body: { profile: null, rev: rec.r, via: p.via, gone: true } };
      return { status: 200, body: { profile: rec.p, rev: rec.r, via: p.via, ...(p.via === 'account' ? { age18: !!rec.a18 } : {}) } };
    }
    if (op === 'delete') {
      if (rec && !rec.gone) { try { store(p.key, { r: rec.r + 1, gone: true }); } catch { return { status: 503, body: { error: 'storage-failed' } }; } }
      log({ event: 'duell-profile-deleted', via: p.via });
      return { status: 200, body: { deleted: true } };
    }
    // put. A new sync-code profile only from someone signed in (16+ by the account's own statement, e.g. a parent for a
    // child): an anonymous script could otherwise fill the store; the tunnel gives no client IP to limit it by. Who has a
    // code that exists keeps syncing without an account (other devices, the Android shell). The account is not stored.
    // The login is asked before the checks, and the record read again after it: from here to the write nothing awaits, so
    // two puts of the same new code cannot both create it (the second sees rev 1 and gets 409).
    let starter = null;
    if (p.via === 'code' && (!rec || rec.gone)) {
      const id = canLogin && p.req ? await auth.identify(p.req) : { email: null };
      if (id.error) return { status: 503, body: { error: 'auth-unavailable' } };
      if (id.email) starter = mac('starter:' + id.email.toLowerCase());
      rec = load(p.key);
    }
    const t = now(), rev = rec ? rec.r : 0;
    if (rec && rec.gone && body.fresh !== true) return { status: 410, body: { error: 'gone', rev } };
    if (body.rev !== rev) return { status: 409, body: { error: 'stale', rev } };
    const isNew = !rec || !!rec.gone;
    if (p.via === 'account' && isNew && body.age16 !== true) return { status: 403, body: { error: 'age16' } };
    if (!isNew) starter = null;
    if (p.via === 'code' && isNew) {
      if (!starter) return { status: 403, body: { error: 'code-needs-login', login_url: canLogin ? auth.loginUrl('/duell') : undefined } };
      if (hits(starts, starter, t, DAY).length >= cfg.accountNewPerDay) return { status: 429, body: { error: 'new-limit' }, headers: { 'Retry-After': '3600' } };
    }
    if (hits(writes, p.key, t, HOUR).length >= cfg.writesPerHour) return { status: 429, body: { error: 'rate-limited' }, headers: { 'Retry-After': '600' } };
    if (!rec) {   // a deleted profile started again is no new file
      if (count >= cfg.max) return { status: 429, body: { error: 'full' }, headers: { 'Retry-After': '3600' } };
      const hour = Math.floor(t / HOUR);
      if (news.hour !== hour) { news.hour = hour; news.n = 0; }
      if (news.n >= cfg.newPerHour) return { status: 429, body: { error: 'new-limit' }, headers: { 'Retry-After': '3600' } };
      if (ip && (hits(fresh, ip, t, HOUR).length >= cfg.ipNewPerHour || hits(freshDay, ip, t, DAY).length >= cfg.ipNewPerDay)) return { status: 429, body: { error: 'new-limit' }, headers: { 'Retry-After': '3600' } };
    }
    const next = { r: rev + 1, p: cleanProfile(body.profile, p.via) };
    if (p.via === 'account') next.c = !isNew && rec.c ? rec.c : new Date(t).toISOString().slice(0, 10);
    // 18+: the account's own statement (the app's age band "18+ (eigene Angabe)"), a self-declaration like 16+, not a
    // verified age; kept with its day like the 16+ one. age18: true
    // makes it (or keeps its first day), false takes it back, absent leaves it as it is. Only for accounts.
    if (p.via === 'account') {
      if (body.age18 === true) next.a18 = !isNew && rec.a18 ? rec.a18 : new Date(t).toISOString().slice(0, 10);
      else if (body.age18 !== false && !isNew && rec.a18) next.a18 = rec.a18;
    }
    const json = JSON.stringify(next), size = Buffer.byteLength(json), grow = size - sizeOf(p.key);
    if (size > cfg.profileBytes) return { status: 413, body: { error: 'profile-too-large', max: cfg.profileBytes } };
    // Fail-closed at the total: nothing new and nothing growing; what is there stays readable, shrinking and deleting work.
    if (grow > 0 && bytes + grow > cfg.maxBytes) { log({ event: 'duell-profile-full', bytes }); return { status: 429, body: { error: 'full' }, headers: { 'Retry-After': '3600' } }; }
    try { store(p.key, next, json); } catch (e) { log({ event: 'duell-profile-write-failed', why: String(e && e.message || e).slice(0, 120) }); return { status: 503, body: { error: 'storage-failed' } }; }
    hit(writes, p.key, t, HOUR);
    if (starter) hit(starts, starter, t, DAY);
    if (!rec) { count++; news.n++; if (ip) { hit(fresh, ip, t, HOUR); hit(freshDay, ip, t, DAY); } log({ event: 'duell-profile-created', via: p.via }); }
    return { status: 200, body: { rev: next.r, via: p.via } };
  }

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = []; let size = 0, big = false;
      req.on('data', (c) => { size += c.length; if (size > LIMITS.body) big = true; else chunks.push(c); });
      req.on('end', () => { if (big) return resolve({ big: true }); try { resolve({ json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { resolve({ bad: true }); } });
      req.on('error', () => resolve({ bad: true }));
    });
  }

  /** Returns true when the request was ours. Called before the login gate: it reads the login itself. */
  async function route(req, res, url) {
    const m = url.pathname.match(/^\/api\/duell\/profile\/(get|put|delete)$/);
    if (!m) return false;
    // Same CORS rules as the other Duell routes (the Android shell's origin, same origin); cookies only ever arrive same-origin.
    const cors = shared.corsFor(req);
    if (!cors.ok) { req.resume(); shared.send(res, 403, { error: 'origin' }, cors.headers); return true; }
    if (req.method === 'OPTIONS') {
      req.resume();
      const h = cors.headers['Access-Control-Allow-Origin'] ? { ...cors.headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } : {};
      res.writeHead(204, h).end(); return true;
    }
    if (req.method !== 'POST') { req.resume(); shared.send(res, 405, { error: 'method' }, { ...cors.headers, Allow: 'POST, OPTIONS' }); return true; }
    if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') { req.resume(); shared.send(res, 415, { error: 'bad-media' }, cors.headers); return true; }
    if (Number(req.headers['content-length']) > LIMITS.body) { req.resume(); shared.send(res, 413, { error: 'too-large' }, cors.headers); return true; }
    const b = await readBody(req);
    if (b.big) { shared.send(res, 413, { error: 'too-large' }, cors.headers); return true; }
    if (b.bad) { shared.send(res, 400, { error: 'bad-json' }, cors.headers); return true; }
    const r = await handle(m[1], b.json, req, shared.clientKey(req));
    shared.send(res, r.status, r.body, { ...cors.headers, ...(r.headers || {}) });
    return true;
  }

  // The free card (lib/duell-karte.mjs) is for 16+ only and checks that here, on the server: true only when this account
  // made the "I am 16 or older" statement for its profile (its day is kept as c). null: no profile storage, nothing known.
  const age16 = (email) => { if (!ok || typeof email !== 'string' || !email) return null; const r = load('a' + mac('account:' + email.toLowerCase())); return !!(r && !r.gone && r.c); };
  // 18+ the same way (lib/duell-karte.mjs: abilities marked [from 18], collecting money): true only with the statement a18.
  const age18 = (email) => { if (!ok || typeof email !== 'string' || !email) return null; const r = load('a' + mac('account:' + email.toLowerCase())); return !!(r && !r.gone && r.c && r.a18); };
  if (shared) { shared.age16 = age16; shared.age18 = age18; }
  return { route, handle, cfg, age16, age18, enabled: () => ok, _count: () => count, _bytes: () => bytes };
}
