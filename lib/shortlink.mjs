// Short links of My Daily Idea.
//
//   POST   /api/s            { f, k?, n?, l? } -> 201 { id, url, token, exp }   only after a tap on share
//   GET    /api/s/<id>       -> { f, exp }                                      the app shells turn /s/<id> back into the fragment
//   DELETE /api/s/<id>       Authorization: Bearer <token> -> 204               the creator, with the token kept on the device
//   PUT    /api/s/<id>/img   Authorization: Bearer <token>, image/jpeg 1200x630 -> 204   the chat preview, once per link
//   GET    /s/<id>           small page: Open Graph tags for crawlers, a script for browsers (works without login)
//   GET    /s/img/<id>.jpg   the picture of that link, while the link lives
//   GET    /s/img/<kind>.jpg fixed preview picture per mechanic, for links without a picture of their own
//   block(id)                 not a route: a reviewer blocks a reported link (lib/duell-report.mjs); it answers 410 from then on
// A link that holds a free card (freeIdsOf: the card link { v: 1, d: doc } or a state with ki/fr) opens, shows its page and its picture only while the deck (free) says "ok" for
// that card: removed, held, never registered or not checkable -> 410/503 "nicht mehr verfuegbar" (fail closed).
//
// Fragments (f, without "#"): the old app's c=<base64url JSON> and i=<idea id> (at most MAX_FRAGMENT), and the new app's
// v2.card.<b64> and v2.challenge.<b64> (at most V2_MAX, envelope checked by lib/link-v2.mjs; v2.live and v2.ghost never).
// A v2 link with a free card: the server asks exactly what the app asks, with the app's own code (lib/vendor/mdi, copied by
// bin/vendor-mdi.mjs with provenance): doc = card.toFree(p) of the link's card, then gateChecksOf(doc) -> a sealed card with
// the gate hash of its shown content (optionHash(gateView(doc))), a remix by its id. A card without toFree holds no free card,
// for the app and here. The page sends a browser only to this host: SHORT_V2_PATH (default /duell) + "#" + the checked
// fragment, for the old forms /duell + "#" + fragment as before.
//
// What is stored: the fragment as opaque text (it can hold nicknames and the texts of a work, never a photo),
// the mechanic, a score, the language, a hash of the delete token, and, if the app sent one, the finished picture
// of the work. Never an IP, not even hashed: the salted per-IP counters live in memory only. Title and description
// of the preview come from fixed tables; the picture shows the work as the app drew it, with the texts that passed
// the app's word filter. The app never sends a picture of a photo poster, so no photo reaches this server.
//
// Storage is one JSON-lines file in SHORT_DATA_DIR, which must be a volume (the container is recreated by
// `docker run`). Without SHORT_DATA_DIR the service answers 503 and the app keeps its long link, on purpose:
// a default inside the container would lose every link on the next deploy without anybody noticing.
//
// Everything is injectable (env, clock) so the tests need no network.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateHash } from './duell-deck.mjs';   // the shown content of a free card (status gate)
import { optionHash } from './duell-seal.mjs';
import { CARDS as MDI_CARDS, gateChecksOf as mdiGateChecks, gateView as mdiGateView } from './vendor/mdi/index.js';   // the app's code, not a copy of it written here
import { V2_MAX, decodeV2 } from './link-v2.mjs';

// 8 characters from 56 (no 0 O 1 l I: the link is also read off a picture) = 46 bits, drawn with a CSPRNG.
export const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
export const ID_LEN = 8;
export const ID_RE = /^[2-9a-km-np-zA-HJ-NP-Z]{8}$/;
export const MAX_FRAGMENT = 2048;
// The two link forms that are safe to keep. Anything else stays a long link, in particular p= (holds a secret key).
export const FRAGMENT_RE = /^(?:c=[A-Za-z0-9_-]+={0,2}|i=[a-z0-9-]{1,32})$/;
export { V2_MAX };
export const KINDS = ['game', 'photo', 'sound', 'card', 'idea'];
const BODY_MAX = 4608;   // a v2 fragment of V2_MAX characters plus k, n, l
const IMG_MAX = 400 * 1024, IMG_W = 1200, IMG_H = 630;
const DAY = 86400000;
const HOUR = 3600000;
const SCORE_MAX = 999999;

const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
export const newId = () => Array.from({ length: ID_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const tokenHash = (t) => createHash('sha256').update(String(t)).digest();
/** Width and height from the frame header of a baseline or progressive JPEG; null for anything else. */
export function jpegSize(b) {
  if (!Buffer.isBuffer(b) || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

const TEXT = {
  de: {
    game: ['Schaffst du dieses Spiel?', 'Schlag meine {n} Punkte!'], photo: ['Mein Bild von heute'], sound: ['Hör dir das an'], card: ['Meine Karte von heute'], idea: ['Die Idee von heute'],
    desc: 'Öffnen, mitmachen, remixen. Läuft ohne App im Browser.', open: 'Jetzt öffnen', opening: 'Wird geöffnet …',
    goneT: 'Dieser Link ist abgelaufen', goneD: 'Kurzlinks halten 90 Tage oder bis zum Löschen. Die Idee von heute wartet trotzdem auf dich.',
    missT: 'Diesen Link kennen wir nicht', missD: 'Vielleicht fehlt ein Zeichen. Die Idee von heute wartet trotzdem auf dich.',
    limitT: 'Einen Moment bitte', limitD: 'Gerade kommen zu viele Anfragen von dir. Versuch es gleich noch einmal.',
    freeT: 'Diese Karte ist nicht mehr verfügbar', freeD: 'Die freie Karte wurde entfernt oder kann gerade nicht geprüft werden.',
    blockT: 'Dieser Link wurde gesperrt', blockD: 'Nach einer Meldung haben wir den Inhalt geprüft und entfernt.',
    start: 'Zur Idee von heute',
  },
  en: {
    game: ['Can you beat this game?', 'Beat my {n} points!'], photo: ['My picture of the day'], sound: ['Listen to this'], card: ['My card of the day'], idea: ['Today’s idea'],
    desc: 'Open it, join in, remix it. Runs in the browser without an app.', open: 'Open now', opening: 'Opening …',
    goneT: 'This link has expired', goneD: 'Short links last 90 days or until they are deleted. Today’s idea is still waiting for you.',
    missT: 'We do not know this link', missD: 'Maybe a character is missing. Today’s idea is still waiting for you.',
    limitT: 'One moment please', limitD: 'Too many requests from you right now. Try again in a moment.',
    freeT: 'This card is no longer available', freeD: 'The free card was removed or cannot be checked right now.',
    blockT: 'This link has been blocked', blockD: 'After a report we checked the content and removed it.',
    start: 'To today’s idea',
  },
};
const langOf = (req) => (/^en\b/i.test(String(req.headers['accept-language'] || '')) ? 'en' : 'de');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only the href of #go, which is validated, is variable; the script itself is fixed and pinned by hash in the CSP.
export const OPEN_SCRIPT = "location.replace(document.getElementById('go').href)";
const SCRIPT_HASH = createHash('sha256').update(OPEN_SCRIPT).digest('base64');
const STYLE = 'body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;box-sizing:border-box;background:#ffd400;color:#111;font:600 17px/1.4 system-ui,sans-serif;text-align:center}img{width:min(100%,420px);height:auto;border:3px solid #111}h1{margin:0;font-size:26px}p{margin:0}a{display:inline-block;padding:13px 20px;background:#111;color:#ffd400;font-weight:800;text-decoration:none;border-radius:4px}';

// Which flight game a shared game link holds: "welt" when its sheet or state carries the AI mark of the welt kind (ki.k,
// with a seal), otherwise "game" (sliders, an idea, a card made playable). Read from the fragment the app sends anyway;
// nothing new leaves the device. Counted as (kind, "share") only: no id, no text, no person (KI-Konzept 6.8, MVP 1).
export function shareKind(f) {
  const m = /^c=([A-Za-z0-9_-]+)={0,2}$/.exec(String(f || ''));
  if (!m) return 'game';
  try {
    const o = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')), ki = o && (o.ki || (o.d && o.d.ki));
    return ki && ki.k === 'welt' && typeof ki.s === 'string' && ki.s ? 'welt' : 'game';
  } catch { return 'game'; }
}

/**
 * The free card's id inside a link fragment (c= is base64url JSON of the app's state, apps/duell-web core.js encodeState):
 * the root of a remix (fr) or the seal of the card itself (ki.k "karte", ki.h). '' for anything else.
 */
export function freeIdsOf(f) {
  if (typeof f === 'string' && f.startsWith('v2.')) return [...new Set(v2Checks(f).map(([cid]) => cid).filter(Boolean))];
  if (typeof f !== 'string' || !f.startsWith('c=')) return [];
  let o;
  try { o = JSON.parse(Buffer.from(f.slice(2), 'base64url').toString('utf8')); } catch { return []; }
  const ids = [];
  // the app's card link is { v: 1, d: doc } (daily.js docUrl); a game or other state carries ki at its top
  for (const x of [o, o && o.d]) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    if (typeof x.fr === 'string' && /^[A-Za-z0-9_-]{22}$/.test(x.fr)) ids.push(x.fr);
    const k = x.ki;
    if (k && k.k === 'karte' && typeof k.h === 'string' && /^[A-Za-z0-9_-]{43}$/.test(k.h)) ids.push(k.h.slice(0, 22));
  }
  return [...new Set(ids)];
}
/** [cid, gate hash | undefined] for every free card id of a link: a doc that carries its own seal (ki.h) is checked with the
 * gate hash of the content it shows (lib/duell-deck.mjs gateHash); a remix id (fr) by the id alone. */
export function freeChecksOf(f) {
  if (typeof f === 'string' && f.startsWith('v2.')) return v2Checks(f);
  if (typeof f !== 'string' || !f.startsWith('c=')) return [];
  let o;
  try { o = JSON.parse(Buffer.from(f.slice(2), 'base64url').toString('utf8')); } catch { return []; }
  const out = new Map();
  for (const x of [o, o && o.d]) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    if (typeof x.fr === 'string' && /^[A-Za-z0-9_-]{22}$/.test(x.fr) && !out.has(x.fr)) out.set(x.fr, undefined);
    const k = x.ki;
    if (k && k.k === 'karte' && typeof k.h === 'string' && /^[A-Za-z0-9_-]{43}$/.test(k.h)) out.set(k.h.slice(0, 22), gateHash(x));
    // a free card's seal without a valid hash is never checkable (security review H1): an empty id, which the deck answers
    // with "unknown", so the link is closed (fail closed), never treated as a link without a free card
    else if (k && typeof k === 'object' && k.k === 'karte') out.set('', undefined);
  }
  return [...out.entries()];
}
// ---- free cards in a v2 link (apps/mdi) ---------------------------------------------------------------------------------
/**
 * [cid, gate hash | undefined] for a v2 link, like freeChecksOf: the app's freeDocOf (card.toFree of the link's card, null
 * when it has none or throws) and gateChecksOf, both from lib/vendor/mdi. Test vectors: test/link-v2.test.mjs.
 */
function v2Checks(f) {
  const r = decodeV2(f);
  if (!r.ok || !Object.prototype.hasOwnProperty.call(MDI_CARDS, r.data.c)) return [];
  let doc = null;
  try { doc = MDI_CARDS[r.data.c].toFree(r.data.p); } catch { doc = null; }
  return mdiGateChecks(doc).map(({ cid, doc: d }) => [cid, d ? optionHash(mdiGateView(d)) : undefined]);
}
/** A fragment this server keeps: c= or i= of the old app, or a v2 card/challenge whose envelope passes (lib/link-v2.mjs). */
export function fragmentOk(f) {
  if (typeof f !== 'string') return false;
  if (f.startsWith('v2.')) return decodeV2(f).ok;
  return Buffer.byteLength(f) <= MAX_FRAGMENT && FRAGMENT_RE.test(f);
}

/** The first free card id of a link ('' for none); freeIdsOf gives all of them (a remix names its root and maybe its own). */
export const freeCidOf = (f) => freeIdsOf(f)[0] || '';

// free: () => the deck (lib/duell-deck.mjs: linkState, sharedAs), asked on every fetch of a link that holds a free card
export function createShortLinks({ env = process.env, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)), clientKey = () => null, root, metric = null, free = null } = {}) {
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
    v2Path: env.SHORT_V2_PATH || '/duell',                // where the new app opens a v2 fragment, a path on this host
  };
  // a path, never a scheme or another host ("//x" would be one): a wrong value stops the start instead of sending people away
  if (!/^\/[a-z0-9][a-z0-9_/-]{0,63}$/.test(cfg.v2Path) || cfg.v2Path.includes('//')) throw new Error('SHORT_V2_PATH must be a path on this host, e.g. /duell');
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
      mkdirSync(join(cfg.dataDir, 'img'), { recursive: true, mode: 0o700 });
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
  const tombstone = (id, t) => { dropPic(id); return { id, gone: true, exp: t, until: t + cfg.graceMs }; };
  const picFile = (id) => (cfg.dataDir && ID_RE.test(id) ? join(cfg.dataDir, 'img', `${id}.jpg`) : '');
  const hasPic = (id) => { const p = picFile(id); return !!p && existsSync(p); };
  function dropPic(id) { const p = picFile(id); if (p) try { rmSync(p, { force: true }); } catch { /* the sweep tries again */ } }
  const owner = (r, token) => { const a = tokenHash(token), b = Buffer.from(r.h, 'hex'); return !!token && a.length === b.length && timingSafeEqual(a, b); };
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const lookup = (id) => { const r = links.get(id); if (!r) return null; return r.gone || now() >= r.exp ? { gone: true, blocked: !!r.blocked } : r; };
  const recent = (map, who, t) => { const a = (map.get(who) || []).filter((x) => t - x < HOUR); map.set(who, a); return a; };
  const trim = (map, t) => { if (map.size > 5000) for (const [k, v] of map) if (!v.some((x) => t - x < HOUR)) map.delete(k); };

  /**
   * A link that holds a free card opens only while the deck says "ok" (removed, held, unknown or the deck not readable:
   * closed, fail-closed). -> null for any other link, else 'ok' | 'blocked' | 'unknown' | 'unavailable'.
   */
  function freeState(f) {
    const ids = freeChecksOf(f);
    if (!ids.length) return null;
    // every id the link names must be "ok": one blocked id blocks the link (a remix cannot borrow another card's id); a card
    // with its own seal must also show its own content (gate hash), else it is blocked like a removed one
    const sts = ids.map(([cid, gh]) => {
      // a free card without a valid id (a seal without its hash: apps/mdi gateChecksOf {cid: null}, #131 freeChecksOf '') is
      // never checkable: "unknown" here, without relying on the deck to refuse an empty id (security review H1)
      if (typeof cid !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(cid)) return 'unknown';
      let st = 'unavailable';
      try { const d = free ? free() : null; st = d && typeof d.linkState === 'function' ? d.linkState(cid, gh) : 'unavailable'; } catch { st = 'unavailable'; }
      return st === 'changed' ? 'blocked' : ['ok', 'blocked', 'unknown'].includes(st) ? st : 'unavailable';
    });
    for (const s of ['blocked', 'unavailable', 'unknown']) if (sts.includes(s)) return s;
    return 'ok';
  }
  /** True while this client is over its limit of unknown ids. It then learns nothing, not even about ids that exist. */
  const missBlocked = (who) => !!who && recent(misses, who, now()).length >= cfg.missPerHour;
  function noteMiss(who) { if (!who) return; const t = now(); recent(misses, who, t).push(t); trim(misses, t); }

  /** Pure core of POST /api/s (also what the tests call). */
  function create(input, who) {
    if (!ok) return { status: 503, body: { error: 'storage-off' } };
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.f !== 'string') return { status: 400, body: { error: 'bad-request' } };
    const v2 = input.f.startsWith('v2.'), max = v2 ? V2_MAX : MAX_FRAGMENT;
    if (Buffer.byteLength(input.f) > max) return { status: 413, body: { error: 'too-large', max } };
    if (v2) { const d = decodeV2(input.f); if (!d.ok) return { status: 400, body: { error: 'bad-fragment', reason: d.reason } }; }
    else if (!FRAGMENT_RE.test(input.f)) return { status: 400, body: { error: 'bad-fragment' } };
    sweep();
    const t = now();
    if (who && recent(hits, who, t).length >= cfg.ipPerHour) return { status: 429, body: { error: 'rate-limited' }, headers: { 'Retry-After': '3600' } };
    if (daily.day !== day()) { daily.day = day(); daily.n = 0; }
    if (daily.n >= cfg.dailyMax) return { status: 429, body: { error: 'daily-limit' }, headers: { 'Retry-After': '3600' } };
    if (links.size >= cfg.maxLive) return { status: 429, body: { error: 'full' }, headers: { 'Retry-After': '3600' } };
    // a free card gets a short link only while it may be shown (registered, not blocked); the app keeps its long link
    const fs0 = freeState(input.f);
    if (fs0 && fs0 !== 'ok') return { status: fs0 === 'unavailable' ? 503 : 409, body: { error: 'card-' + fs0 } };
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
    if (fs0) { try { for (const cid of freeIdsOf(input.f)) free().sharedAs(cid, id); } catch (e) { log({ event: 'shortlink-free-note-failed' }); } }
    log({ event: 'shortlink-created', k });
    if (metric && k === 'game' && !v2) metric(shareKind(input.f), 'share', 0);   // share rate of AI worlds vs. slider worlds, old app only
    return { status: 201, body: { id, url: `${cfg.shortBase}/s/${id}`, token, exp: rec.exp } };
  }

  /** Pure core of PUT /api/s/<id>/img: the chat preview, a JPEG of exactly 1200x630, once, only by the creator. */
  function putPicture(id, token, body) {
    if (!ok) return { status: 503, body: { error: 'storage-off' } };
    const r = ID_RE.test(id) ? links.get(id) : null;
    if (!r) return { status: 404, body: { error: 'unknown' } };
    if (r.gone || now() >= r.exp) return { status: 410, body: { error: 'gone' } };
    if (!owner(r, token)) return { status: 403, body: { error: 'token' } };
    if (!Buffer.isBuffer(body) || body.length > IMG_MAX) return { status: 413, body: { error: 'too-large', max: IMG_MAX } };
    const size = jpegSize(body);
    if (!size || size.w !== IMG_W || size.h !== IMG_H) return { status: 400, body: { error: 'bad-image' } };
    if (hasPic(id)) return { status: 409, body: { error: 'exists' } };
    try { writeFileSync(picFile(id), body, { mode: 0o600, flag: 'wx' }); }
    catch (e) { log({ event: 'shortlink-img-failed', why: String(e && e.message || e).slice(0, 120) }); return { status: 503, body: { error: 'storage-failed' } }; }
    log({ event: 'shortlink-img', k: r.k });
    return { status: 204 };
  }

  /** Pure core of DELETE /api/s/<id>. The content is off the disk when this returns. */
  function remove(id, token) {
    if (!ok) return { status: 503, body: { error: 'storage-off' } };
    const r = ID_RE.test(id) ? links.get(id) : null;
    if (!r) return { status: 404, body: { error: 'unknown' } };
    if (r.gone) return { status: 410, body: { error: 'gone' } };
    if (!owner(r, token)) return { status: 403, body: { error: 'token' } };
    const stone = tombstone(id, now());
    links.set(id, stone);
    try { compact(); }
    catch (e) { links.set(id, r); log({ event: 'shortlink-write-failed', why: String(e && e.message || e).slice(0, 120) }); return { status: 503, body: { error: 'storage-failed' } }; }
    log({ event: 'shortlink-deleted' });
    return { status: 204 };
  }

  /** A reviewer's decision on a report: the content is off the disk when this returns, the link answers 410 "blocked". */
  function block(id) {
    if (!ok) return { status: 503, body: { error: 'storage-off' } };
    const r = ID_RE.test(id) ? links.get(id) : null;
    if (!r) return { status: 404, body: { error: 'unknown' } };
    if (r.blocked) return { status: 204 };
    links.set(id, { ...tombstone(id, now()), until: now() + 365 * DAY, blocked: true });   // kept a year, so the id is not handed out again soon
    try { compact(); }
    catch (e) { links.set(id, r); log({ event: 'shortlink-write-failed', why: String(e && e.message || e).slice(0, 120) }); return { status: 503, body: { error: 'storage-failed' } }; }
    log({ event: 'shortlink-blocked' });
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
  function readRaw(req, max) {
    return new Promise((resolve) => {
      const chunks = []; let size = 0, big = false;
      req.on('data', (c) => { size += c.length; if (size > max) big = true; else chunks.push(c); });
      req.on('end', () => resolve(big ? { big: true } : { buf: Buffer.concat(chunks) }));
      req.on('error', () => resolve({ bad: true }));
    });
  }
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
      const h = cors.headers['Access-Control-Allow-Origin'] ? { ...cors.headers, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' } : {};
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
    // POST /api/s/delete { id, token } and POST /api/s/get { id } (security review M6): the app shells forward only exact paths
    // and send their own Bearer (the account), so the link's token and id travel in the body; DELETE/GET stay for the web
    if ((id === 'delete' || id === 'get') && req.method === 'POST') {
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') { req.resume(); return send(res, 415, { error: 'bad-media' }, cors.headers); }
      const b = await readBody(req);
      if (b.big) return send(res, 413, { error: 'too-large' }, cors.headers);
      if (b.bad || !b.json || typeof b.json !== 'object' || typeof b.json.id !== 'string') return send(res, 400, { error: 'bad-json' }, cors.headers);
      if (id === 'delete') { const r = remove(b.json.id, typeof b.json.token === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.json.token) ? b.json.token : ''); return send(res, r.status, r.body, cors.headers); }
      return resolveApi(res, b.json.id, who, cors);
    }
    const pic = id.match(/^([^/]+)\/img$/);
    if (pic) {
      if (req.method !== 'PUT') { req.resume(); return send(res, 405, { error: 'method' }, { ...cors.headers, Allow: 'PUT, OPTIONS' }); }
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'image/jpeg') { req.resume(); return send(res, 415, { error: 'bad-media' }, cors.headers); }
      if (Number(req.headers['content-length']) > IMG_MAX) { req.resume(); return send(res, 413, { error: 'too-large' }, cors.headers); }
      const m = String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{1,64})$/);
      const b = await readRaw(req, IMG_MAX);
      if (b.big) return send(res, 413, { error: 'too-large' }, cors.headers);
      if (b.bad) return send(res, 400, { error: 'bad-body' }, cors.headers);
      const r = putPicture(pic[1], m ? m[1] : '', b.buf);
      return send(res, r.status, r.body, cors.headers);
    }
    req.resume();
    if (req.method === 'DELETE') {
      const m = String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{1,64})$/);
      const r = remove(id, m ? m[1] : '');
      return send(res, r.status, r.body, cors.headers);
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'method' }, { ...cors.headers, Allow: 'GET, DELETE, OPTIONS' });
    return resolveApi(res, id, who, cors);
  }
  function resolveApi(res, id, who, cors) {
    if (missBlocked(who)) return send(res, 429, { error: 'rate-limited' }, { ...cors.headers, 'Retry-After': '600' });
    sweep();
    const r = ID_RE.test(id) ? lookup(id) : null;
    if (!r) { noteMiss(who); return send(res, 404, { error: 'unknown' }, cors.headers); }
    if (r.gone) return send(res, 410, { error: r.blocked ? 'blocked' : 'gone' }, cors.headers);
    if (!fragmentOk(r.f)) return send(res, 410, { error: 'gone' }, cors.headers);   // a stored line that no longer passes is never handed out
    const fst = freeState(r.f);
    if (fst && fst !== 'ok') return send(res, fst === 'unavailable' ? 503 : 410, { error: fst === 'unavailable' ? 'unavailable' : 'card-' + fst }, cors.headers);
    send(res, 200, { f: r.f, exp: r.exp }, cors.headers);
  }

  function page({ lang, title, desc, kind, id, href, action, script }) {
    const self = id ? `${cfg.publicBase}/s/${id}` : `${cfg.publicBase}/duell`;
    const name = id && hasPic(id) ? id : kind, img = `${cfg.publicBase}/s/img/${name}.jpg`;
    // og:url names this very page, not the portal address: that one redirects here, and a canonical URL that redirects to the page naming it is a circle for link crawlers.
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)}</title>`
      + '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
      + `<meta property="og:type" content="website"><meta property="og:site_name" content="My Daily Idea"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">`
      + `<meta property="og:url" content="${esc(self)}"><meta property="og:image" content="${esc(img)}"><meta property="og:image:secure_url" content="${esc(img)}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="My Daily Idea">`
      + `<meta property="og:locale" content="${lang === 'en' ? 'en_GB' : 'de_DE'}"><meta name="twitter:card" content="summary_large_image">`
      // The link and its script come first, so a browser leaves before the generic picture is even fetched; CSS keeps the order on screen.
      + `<style>${STYLE}#go{order:3}</style></head><body><a id="go" href="${esc(href)}">${esc(action)}</a>`
      + (script ? `<script>${OPEN_SCRIPT}</script>` : '') + `<img src="/s/img/${name}.jpg" alt=""><h1>${esc(title)}</h1><p>${esc(desc)}</p></body></html>`;
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
    if (r.gone) return friendly(req, res, 410, r.blocked ? 'block' : 'gone');
    if (!fragmentOk(r.f)) return friendly(req, res, 410, 'gone');
    const fst = freeState(r.f);
    if (fst && fst !== 'ok') return friendly(req, res, fst === 'unavailable' ? 503 : 410, 'free');
    const T = TEXT[r.l], title = T[r.k][r.n === null ? 0 : 1].replace('{n}', String(r.n));
    // only ever a path on this host plus the checked fragment: no scheme, no host, nothing from the request
    const href = `${r.f.startsWith('v2.') ? cfg.v2Path : '/duell'}#${r.f}`;
    sendPage(req, res, 200, page({ lang: r.l, title, desc: T.desc, kind: r.k, id, href, action: T.open, script: true }));
  }
  function serveImg(req, res, name) {
    const m = name.match(/^([a-z]+)\.jpg$/), own = name.match(/^([2-9a-km-np-zA-HJ-NP-Z]{8})\.jpg$/);
    let f = m && KINDS.includes(m[1]) && cfg.imgDir ? join(cfg.imgDir, `${m[1]}.jpg`) : '';
    if (own) { const r = lookup(own[1]); f = r && !r.gone && fragmentOk(r.f) && [null, 'ok'].includes(freeState(r.f)) ? picFile(own[1]) : ''; }
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
  return { route, create, remove, block, putPicture, hasPic, lookup, sweep, cfg, enabled: () => ok, _state: { links, hits, misses, daily }, _file: () => file };
}
