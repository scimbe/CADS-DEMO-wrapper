// Short links of My Daily Idea.
//
//   POST   /api/s            { f, k?, n?, l? } -> 201 { id, url, token, exp }   only after a tap on share
//   GET    /api/s/<id>       -> { f, exp }                                      the app shells turn /s/<id> back into the fragment
//   DELETE /api/s/<id>       Authorization: Bearer <token> -> 204               the creator, with the token kept on the device
//   GET    /s/<id>           small page: Open Graph tags for crawlers, a script for browsers (works without login)
//   GET    /s/img/<kind>.jpg fixed preview picture per mechanic
//
// What is stored: the fragment as opaque text (it can hold nicknames and the texts of a work, never a photo),
// the mechanic, a score, the language, a hash of the delete token. Never an IP, not even hashed: the salted
// per-IP counters live in memory only. The preview therefore has no user text at all: title and picture come
// from fixed tables, so nothing a person typed appears under our name in a chat.
//
// Storage is one JSON-lines file in SHORT_DATA_DIR, which must be a volume (the container is recreated by
// `docker run`). Without SHORT_DATA_DIR the service answers 503 and the app keeps its long link, on purpose:
// a default inside the container would lose every link on the next deploy without anybody noticing.
//
// Everything is injectable (env, clock) so the tests need no network.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 8 characters from 56 (no 0 O 1 l I: the link is also read off a picture) = 46 bits, drawn with a CSPRNG.
export const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
export const ID_LEN = 8;
export const ID_RE = /^[2-9a-km-np-zA-HJ-NP-Z]{8}$/;
export const MAX_FRAGMENT = 2048;
// The two link forms that are safe to keep. Anything else stays a long link, in particular p= (holds a secret key).
export const FRAGMENT_RE = /^(?:c=[A-Za-z0-9_-]+={0,2}|i=[a-z0-9-]{1,32})$/;
export const KINDS = ['game', 'photo', 'sound', 'card', 'idea'];
const BODY_MAX = 4096;
const DAY = 86400000;
const HOUR = 3600000;
const SCORE_MAX = 999999;

const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
export const newId = () => Array.from({ length: ID_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const tokenHash = (t) => createHash('sha256').update(String(t)).digest();

const TEXT = {
  de: {
    game: ['Schaffst du dieses Spiel?', 'Schlag meine {n} Punkte!'], photo: ['Mein Bild von heute'], sound: ['Hör dir das an'], card: ['Meine Karte von heute'], idea: ['Die Idee von heute'],
    desc: 'Öffnen, mitmachen, remixen. Läuft ohne App im Browser.', open: 'Jetzt öffnen', opening: 'Wird geöffnet …',
    goneT: 'Dieser Link ist abgelaufen', goneD: 'Kurzlinks halten 90 Tage oder bis zum Löschen. Die Idee von heute wartet trotzdem auf dich.',
    missT: 'Diesen Link kennen wir nicht', missD: 'Vielleicht fehlt ein Zeichen. Die Idee von heute wartet trotzdem auf dich.',
    limitT: 'Einen Moment bitte', limitD: 'Gerade kommen zu viele Anfragen von dir. Versuch es gleich noch einmal.',
    start: 'Zur Idee von heute',
  },
  en: {
    game: ['Can you beat this game?', 'Beat my {n} points!'], photo: ['My picture of the day'], sound: ['Listen to this'], card: ['My card of the day'], idea: ['Today’s idea'],
    desc: 'Open it, join in, remix it. Runs in the browser without an app.', open: 'Open now', opening: 'Opening …',
    goneT: 'This link has expired', goneD: 'Short links last 90 days or until they are deleted. Today’s idea is still waiting for you.',
    missT: 'We do not know this link', missD: 'Maybe a character is missing. Today’s idea is still waiting for you.',
    limitT: 'One moment please', limitD: 'Too many requests from you right now. Try again in a moment.',
    start: 'To today’s idea',
  },
};
const langOf = (req) => (/^en\b/i.test(String(req.headers['accept-language'] || '')) ? 'en' : 'de');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only the href of #go, which is validated, is variable; the script itself is fixed and pinned by hash in the CSP.
export const OPEN_SCRIPT = "location.replace(document.getElementById('go').href)";
const SCRIPT_HASH = createHash('sha256').update(OPEN_SCRIPT).digest('base64');
const STYLE = 'body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;box-sizing:border-box;background:#ffd400;color:#111;font:600 17px/1.4 system-ui,sans-serif;text-align:center}img{width:min(100%,420px);height:auto;border:3px solid #111}h1{margin:0;font-size:26px}p{margin:0}a{display:inline-block;padding:13px 20px;background:#111;color:#ffd400;font-weight:800;text-decoration:none;border-radius:4px}';

export function createShortLinks({ env = process.env, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)), clientKey = () => null, root } = {}) {
  const cfg = {
    dataDir: env.SHORT_DATA_DIR || '',
    ttlMs: num(env.SHORT_TTL_DAYS, 90) * DAY,
    graceMs: 30 * DAY,                                 // how long "expired" is still told apart from "unknown"; the content is long gone by then
    ipPerHour: num(env.SHORT_IP_PER_HOUR, 20),
    dailyMax: num(env.SHORT_DAILY_MAX, 2000),
    missPerHour: num(env.SHORT_MISS_PER_HOUR, 60),
    maxLive: num(env.SHORT_MAX_LIVE, 100000),
    shortBase: String(env.SHORT_BASE || 'https://bunsenbrenner.org').replace(/\/$/, ''),   // what people see and share
    publicBase: String(env.SHORT_PUBLIC_BASE || 'https://demos-34a13a96.bunsenbrenner.org').replace(/\/$/, ''), // this host: pictures, no redirect in between
    origins: new Set([...String(env.DUELL_CORS_ORIGINS ?? 'https://appassets.androidplatform.net').split(',').map((s) => s.trim()).filter(Boolean), 'null']), // "null" = the bundled file:// page of the iOS app; no cookies here, so this opens nothing
    imgDir: env.SHORT_IMG_DIR || (root ? join(root, 'static', 'share') : ''),
  };
  const links = new Map();   // id -> { f, k, n, l, h, exp } or, once gone, { id, exp, gone: true, until }
  const hits = new Map();    // hashed client -> [timestamps of creations]
  const misses = new Map();  // hashed client -> [timestamps of unknown ids]
  const daily = { day: '', n: 0 };
  let file = '', ok = false, nextSweep = 0;

  function loadFile() {
    if (!cfg.dataDir) { log({ event: 'shortlink-off', why: 'SHORT_DATA_DIR not set' }); return; }
    try {
      mkdirSync(cfg.dataDir, { recursive: true });
      file = join(cfg.dataDir, 'links.jsonl');
      if (existsSync(file)) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (!line) continue;
          try { const r = JSON.parse(line); if (r && ID_RE.test(r.id)) links.set(r.id, r); } catch { /* half a line from a crash */ }
        }
      }
      appendFileSync(file, '', { mode: 0o600 });
      ok = true;
      sweep(true);
    } catch (e) { ok = false; log({ event: 'shortlink-off', why: String(e && e.message || e).slice(0, 120) }); }
  }
  /** The whole file again, atomically. Removes content that expired or was deleted. */
  function compact() {
    const tmp = file + '.tmp';
    writeFileSync(tmp, [...links.values()].map((r) => JSON.stringify(r) + '\n').join(''), { mode: 0o600, flush: true });
    renameSync(tmp, file);
  }
  /** Expired content is erased from memory and disk here; a tombstone without content stays for the friendly page. */
  function sweep(force) {
    const t = now();
    if (!force && t < nextSweep) return;
    nextSweep = t + HOUR;
    let changed = false;
    for (const [id, r] of links) {
      if (r.gone && t >= r.until) { links.delete(id); changed = true; }
      else if (!r.gone && t >= r.exp) { links.set(id, tombstone(id, t)); changed = true; }
    }
    if (changed && ok) { try { compact(); } catch (e) { log({ event: 'shortlink-compact-failed', why: String(e && e.message || e).slice(0, 120) }); } }
  }
  const tombstone = (id, t) => ({ id, gone: true, exp: t, until: t + cfg.graceMs });
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const lookup = (id) => { const r = links.get(id); if (!r) return null; return r.gone || now() >= r.exp ? { gone: true } : r; };
  const recent = (map, who, t) => { const a = (map.get(who) || []).filter((x) => t - x < HOUR); map.set(who, a); return a; };
  const trim = (map, t) => { if (map.size > 5000) for (const [k, v] of map) if (!v.some((x) => t - x < HOUR)) map.delete(k); };

  /** True while this client is over its limit of unknown ids. It then learns nothing, not even about ids that exist. */
  const missBlocked = (who) => !!who && recent(misses, who, now()).length >= cfg.missPerHour;
  function noteMiss(who) { if (!who) return; const t = now(); recent(misses, who, t).push(t); trim(misses, t); }

  /** Pure core of POST /api/s (also what the tests call). */
  function create(input, who) {
    if (!ok) return { status: 503, body: { error: 'storage-off' } };
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.f !== 'string') return { status: 400, body: { error: 'bad-request' } };
    if (Buffer.byteLength(input.f) > MAX_FRAGMENT) return { status: 413, body: { error: 'too-large', max: MAX_FRAGMENT } };
    if (!FRAGMENT_RE.test(input.f)) return { status: 400, body: { error: 'bad-fragment' } };
    sweep();
    const t = now();
    if (who && recent(hits, who, t).length >= cfg.ipPerHour) return { status: 429, body: { error: 'rate-limited' }, headers: { 'Retry-After': '3600' } };
    if (daily.day !== day()) { daily.day = day(); daily.n = 0; }
    if (daily.n >= cfg.dailyMax) return { status: 429, body: { error: 'daily-limit' }, headers: { 'Retry-After': '3600' } };
    if (links.size >= cfg.maxLive) return { status: 429, body: { error: 'full' }, headers: { 'Retry-After': '3600' } };
    let id = newId();
    while (links.has(id)) id = newId();
    const token = randomBytes(24).toString('base64url');
    const k = KINDS.includes(input.k) ? input.k : 'idea';
    const n = k === 'game' && Number.isInteger(input.n) && input.n >= 0 && input.n <= SCORE_MAX ? input.n : null;
    const rec = { id, f: input.f, k, n, l: input.l === 'en' ? 'en' : 'de', h: tokenHash(token).toString('hex'), exp: t + cfg.ttlMs };
    try { appendFileSync(file, JSON.stringify(rec) + '\n', { mode: 0o600, flush: true }); }
    catch (e) { log({ event: 'shortlink-write-failed', why: String(e && e.message || e).slice(0, 120) }); return { status: 503, body: { error: 'storage-failed' } }; }
    links.set(id, rec);
    daily.n++;
    if (who) { recent(hits, who, t).push(t); trim(hits, t); }
    log({ event: 'shortlink-created', k });
    return { status: 201, body: { id, url: `${cfg.shortBase}/s/${id}`, token, exp: rec.exp } };
  }

  /** Pure core of DELETE /api/s/<id>. The content is off the disk when this returns. */
  function remove(id, token) {
    if (!ok) return { status: 503, body: { error: 'storage-off' } };
    const r = ID_RE.test(id) ? links.get(id) : null;
    if (!r) return { status: 404, body: { error: 'unknown' } };
    if (r.gone) return { status: 410, body: { error: 'gone' } };
    const a = tokenHash(token), b = Buffer.from(r.h, 'hex');
    if (!token || a.length !== b.length || !timingSafeEqual(a, b)) return { status: 403, body: { error: 'token' } };
    const stone = tombstone(id, now());
    links.set(id, stone);
    try { compact(); }
    catch (e) { links.set(id, r); log({ event: 'shortlink-write-failed', why: String(e && e.message || e).slice(0, 120) }); return { status: 503, body: { error: 'storage-failed' } }; }
    log({ event: 'shortlink-deleted' });
    return { status: 204 };
  }

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  const corsFor = (req) => {
    const o = req.headers.origin;
    if (!o) return { ok: true, headers: {} };
    if (cfg.origins.has(o)) return { ok: true, headers: { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } };
    let same = false; try { same = new URL(o).host === req.headers.host; } catch {}
    return same ? { ok: true, headers: {} } : { ok: false, headers: { Vary: 'Origin' } };
  };
  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = []; let size = 0, big = false;
      req.on('data', (c) => { size += c.length; if (size > BODY_MAX) big = true; else chunks.push(c); });
      req.on('end', () => { if (big) return resolve({ big: true }); try { resolve({ json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { resolve({ bad: true }); } });
      req.on('error', () => resolve({ bad: true }));
    });
  }

  async function handleApi(req, res, id) {
    const cors = corsFor(req);
    if (!cors.ok) { req.resume(); return send(res, 403, { error: 'origin' }, cors.headers); }
    if (req.method === 'OPTIONS') {
      req.resume();
      const h = cors.headers['Access-Control-Allow-Origin'] ? { ...cors.headers, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' } : {};
      res.writeHead(204, h).end(); return;
    }
    const who = clientKey(req);
    if (id === null) {
      if (req.method !== 'POST') { req.resume(); return send(res, 405, { error: 'method' }, { ...cors.headers, Allow: 'POST, OPTIONS' }); }
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') { req.resume(); return send(res, 415, { error: 'bad-media' }, cors.headers); }
      if (Number(req.headers['content-length']) > BODY_MAX) { req.resume(); return send(res, 413, { error: 'too-large' }, cors.headers); }
      const b = await readBody(req);
      if (b.big) return send(res, 413, { error: 'too-large' }, cors.headers);
      if (b.bad) return send(res, 400, { error: 'bad-json' }, cors.headers);
      const r = create(b.json, who);
      return send(res, r.status, r.body, { ...cors.headers, ...r.headers });
    }
    req.resume();
    if (req.method === 'DELETE') {
      const m = String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{1,64})$/);
      const r = remove(id, m ? m[1] : '');
      return send(res, r.status, r.body, cors.headers);
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'method' }, { ...cors.headers, Allow: 'GET, DELETE, OPTIONS' });
    if (missBlocked(who)) return send(res, 429, { error: 'rate-limited' }, { ...cors.headers, 'Retry-After': '600' });
    sweep();
    const r = ID_RE.test(id) ? lookup(id) : null;
    if (!r) { noteMiss(who); return send(res, 404, { error: 'unknown' }, cors.headers); }
    if (r.gone) return send(res, 410, { error: 'gone' }, cors.headers);
    send(res, 200, { f: r.f, exp: r.exp }, cors.headers);
  }

  function page({ lang, title, desc, kind, id, href, action, script }) {
    const self = id ? `${cfg.publicBase}/s/${id}` : `${cfg.publicBase}/duell`;
    const img = `${cfg.publicBase}/s/img/${kind}.jpg`;
    // og:url names this very page, not the portal address: that one redirects here, and a canonical URL that redirects to the page naming it is a circle for link crawlers.
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)}</title>`
      + '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
      + `<meta property="og:type" content="website"><meta property="og:site_name" content="My Daily Idea"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">`
      + `<meta property="og:url" content="${esc(self)}"><meta property="og:image" content="${esc(img)}"><meta property="og:image:secure_url" content="${esc(img)}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="My Daily Idea">`
      + `<meta property="og:locale" content="${lang === 'en' ? 'en_GB' : 'de_DE'}"><meta name="twitter:card" content="summary_large_image">`
      + `<style>${STYLE}</style></head><body><img src="/s/img/${kind}.jpg" alt=""><h1>${esc(title)}</h1><p>${esc(desc)}</p><a id="go" href="${esc(href)}">${esc(action)}</a>`
      + (script ? `<script>${OPEN_SCRIPT}</script>` : '') + '</body></html>';
  }
  function sendPage(req, res, status, html, extra = {}) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${SCRIPT_HASH}'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, ...extra,
    });
    res.end(req.method === 'HEAD' ? undefined : html);
  }
  function friendly(req, res, status, k, extra) {
    const lang = langOf(req), T = TEXT[lang];
    sendPage(req, res, status, page({ lang, title: T[k + 'T'], desc: T[k + 'D'], kind: 'idea', href: '/duell', action: T.start }), extra);
  }
  function handleLink(req, res, id) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { req.resume(); res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const who = clientKey(req);
    if (missBlocked(who)) return friendly(req, res, 429, 'limit', { 'Retry-After': '600' });
    sweep();
    const r = ID_RE.test(id) ? lookup(id) : null;
    if (!r) { noteMiss(who); return friendly(req, res, 404, 'miss'); }
    if (r.gone) return friendly(req, res, 410, 'gone');
    const T = TEXT[r.l], title = T[r.k][r.n === null ? 0 : 1].replace('{n}', String(r.n));
    sendPage(req, res, 200, page({ lang: r.l, title, desc: T.desc, kind: r.k, id, href: `/duell#${r.f}`, action: T.open, script: true }));
  }
  function serveImg(req, res, name) {
    const m = name.match(/^([a-z]+)\.jpg$/);
    const f = m && KINDS.includes(m[1]) && cfg.imgDir ? join(cfg.imgDir, `${m[1]}.jpg`) : '';
    if (req.method !== 'GET' && req.method !== 'HEAD') { req.resume(); res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    if (!f || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found'); return; }
    const body = readFileSync(f);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  /** Returns true when the request was ours. Called before the login gate: these routes are public by design. */
  async function route(req, res, url) {
    const p = url.pathname;
    if (p === '/api/s') { await handleApi(req, res, null); return true; }
    if (p.startsWith('/api/s/')) { await handleApi(req, res, p.slice('/api/s/'.length)); return true; }
    if (p.startsWith('/s/img/')) { serveImg(req, res, p.slice('/s/img/'.length)); return true; }
    if (p.startsWith('/s/')) { handleLink(req, res, p.slice('/s/'.length).replace(/\/$/, '')); return true; }
    return false;
  }

  loadFile();
  return { route, create, remove, lookup, sweep, cfg, enabled: () => ok, _state: { links, hits, misses, daily }, _file: () => file };
}
