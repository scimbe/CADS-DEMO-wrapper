// My Daily Idea: reporting AI content, checking the AI seal, and the reviewer's view (DSA notice and action).
//
//   POST /api/duell/report         { reason, kind?, link?, seal?, option? | optionHash?, consent?, content? } -> 202 { id }
//                                  a generated picture: kind "bild", seal, option { bild: id } (lib/duell-bild.mjs onBild)
//   POST /api/duell/seal           { seal, content } | { seal, optionHash } -> { valid, kind?, at? }   anybody may check a seal
//   GET  /api/duell/report         Authorization: Bearer <DUELL_ADMIN_TOKEN> -> { open: [...] }
//   POST /api/duell/report/<id>    Authorization: Bearer <DUELL_ADMIN_TOKEN>, { action: dismiss|block } -> { id, action }
//   GET  /api/duell/metrics        Authorization: Bearer <DUELL_ADMIN_TOKEN> -> { since, rows: [{ kind, outcome, n, msAvg, msMax }], queue }
//
// A report carries the reported content only after an explicit yes (`consent: true`); without it the content is dropped before
// anything is stored, and the report holds just reason, kind, link id and seal. Never an IP (the per-IP counter lives in memory,
// salted), never a device id. Reports go to DUELL_REPORT_DIR/reports.jsonl, which must be on a volume; without it the endpoint
// answers 503 and the app says so. A decision erases the content from the file; "block" also blocks the short link.
// Without DUELL_ADMIN_TOKEN the reviewer routes answer 503.
//
// Retention: an open report keeps its content at most DUELL_REPORT_KEEP_DAYS (default 30), then only reason, kind, link and
// seal remain; a closed record leaves after DUELL_REPORT_KEEP_DAYS from its decision, an open one after twice that time.
// A meeting protocol (kind "protokoll") is never stored, not even with consent: it holds the names and words of other people,
// whom the reporter's yes does not cover, and the protocol page promises "no storage". Its seal is still checked.
// Whether a report is about a protocol follows the seal (its kind), not the kind the client sends.
//
// Seal check: `option` is exactly what the seal covers (options[i] of /api/duell/ai, the config without seal/meter/cost/receipt).
// It is used to check the seal and never stored, so it needs no consent. Instead of `option` a client may send `optionHash`
// (doc.ki.h: base64url SHA-256 of the canonical option, 43 characters); that checks an s2 seal only, never an s1 seal. `content` is what the reporter agreed to hand over
// (the whole sheet, say); without `option` the seal is checked against it, as before. A valid seal sets the record's kind.
// A hash that was checked is kept in the record (`optionHash`, no content in it), with `contentOk` when content came along:
// whether that content is the very option the hash stands for.
// The retention also runs every DUELL_REPORT_EXPIRE_MS (default one hour), not only when somebody reads or writes.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, HASH_RE, optionHash, SEAL_RE } from './duell-seal.mjs';
import { ID_RE } from './shortlink.mjs';

export const REASONS = ['harm', 'sex', 'hate', 'private', 'wrong', 'other'];
const CONTENT_MAX = 16 * 1024;   // a protocol is the longest content an app shows
const SEAL_MAX = 200;            // real seals are about 50 characters; the app accepts up to 200
const HOUR = 3600000;
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };

export function createReports({ env = process.env, shared, blockLink = () => ({ status: 503 }), onCard = null, onBild = null, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)) } = {}) {
  const cfg = {
    dir: env.DUELL_REPORT_DIR || '',
    perHour: num(env.DUELL_REPORT_PER_HOUR, 5),
    dailyMax: num(env.DUELL_REPORT_DAILY_MAX, 300),
    keepMs: num(env.DUELL_REPORT_KEEP_DAYS, 30) * 86400000,
    expireEveryMs: num(env.DUELL_REPORT_EXPIRE_MS, 3600000),
    admin: env.DUELL_ADMIN_TOKEN && String(env.DUELL_ADMIN_TOKEN).length >= 16 ? createHash('sha256').update(String(env.DUELL_ADMIN_TOKEN)).digest() : null,
  };
  const reports = new Map();   // id -> record
  const hits = new Map();      // hashed client -> [timestamps]
  const daily = { day: '', n: 0 };
  let file = '', ok = false;

  function load() {
    if (!cfg.dir) { log({ event: 'duell-report-off', why: 'DUELL_REPORT_DIR not set' }); return; }
    try {
      mkdirSync(cfg.dir, { recursive: true, mode: 0o700 });
      file = join(cfg.dir, 'reports.jsonl');
      if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        try { const r = JSON.parse(line); if (r && typeof r.id === 'string') reports.set(r.id, { ...(reports.get(r.id) || {}), ...r }); } catch { /* half a line from a crash */ }
      }
      appendFileSync(file, '', { mode: 0o600 });
      ok = true;
    } catch (e) { ok = false; log({ event: 'duell-report-off', why: String(e && e.message || e).slice(0, 120) }); }
  }
  function compact() {
    const tmp = file + '.tmp';
    writeFileSync(tmp, [...reports.values()].map((r) => JSON.stringify(r) + '\n').join(''), { mode: 0o600, flush: true });
    renameSync(tmp, file);
  }
  const out = (status, body, headers = {}) => ({ status, body, headers });
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const NO_CONTENT = new Set(['protokoll']);   // kinds whose content is never stored (see the head of this file)

  /** Applies the retention to memory and file. Runs on start, with every read or write and every cfg.expireEveryMs. */
  function expire() {
    if (!ok) return;
    const t = now(), old = (iso, ms) => t - Date.parse(iso) > ms;
    let changed = false;
    for (const [id, r] of reports) {
      if (r.state !== 'open' ? old(r.closedAt || r.at, cfg.keepMs) : old(r.at, 2 * cfg.keepMs)) { reports.delete(id); changed = true; }
      else if (r.content !== undefined && old(r.at, cfg.keepMs)) { const c = { ...r, contentExpired: true }; delete c.content; reports.set(id, c); changed = true; }
    }
    if (changed) try { compact(); } catch (e) { log({ event: 'duell-report-write-failed', why: String(e && e.message || e).slice(0, 120) }); }
  }

  /** Pure core of POST /api/duell/report. who: the salted client hash or null. */
  function report(input, who, req) {
    if (!ok) return out(503, { error: 'storage-off' });
    if (!input || typeof input !== 'object' || Array.isArray(input) || !REASONS.includes(input.reason)) return out(400, { error: 'bad-request', reasons: REASONS });
    expire();
    const t = now();
    if (who) {
      const arr = (hits.get(who) || []).filter((x) => t - x < HOUR);
      hits.set(who, arr);
      if (arr.length >= cfg.perHour) return out(429, { error: 'rate-limited' }, { 'Retry-After': String(Math.max(1, Math.ceil((arr[0] + HOUR - t) / 1000))) });
    }
    if (daily.day !== day()) { daily.day = day(); daily.n = 0; }
    if (daily.n >= cfg.dailyMax) return out(429, { error: 'daily-limit' }, { 'Retry-After': '3600' });
    const kind = typeof input.kind === 'string' && /^[a-z]{1,16}$/.test(input.kind) ? input.kind : null;
    const link = typeof input.link === 'string' && ID_RE.test(input.link) ? input.link : null;
    const seal = typeof input.seal === 'string' && input.seal.length <= SEAL_MAX ? input.seal : null;
    const rec = { id: randomBytes(9).toString('base64url'), at: new Date(t).toISOString(), state: 'open', reason: input.reason, kind, link, seal, sealOk: null };
    const has = (v) => v !== undefined && v !== null;
    const consented = input.consent === true && has(input.content);   // the content only after an explicit yes
    for (const v of [input.option, consented ? input.content : undefined]) if (has(v) && Buffer.byteLength(canonical(v)) > CONTENT_MAX) return out(413, { error: 'too-large', max: CONTENT_MAX });
    const sealed = has(input.option) ? input.option : consented ? input.content : undefined;   // what the seal is checked against
    const hash = !has(input.option) && typeof input.optionHash === 'string' && HASH_RE.test(input.optionHash) ? input.optionHash : undefined;
    if (seal && (hash !== undefined || sealed !== undefined)) {
      const v = hash !== undefined ? shared.sealer.verifyHash(seal, hash) : shared.sealer.verify(seal, sealed);
      rec.sealOk = v.valid;
      if (v.valid) rec.kind = v.kind;   // the seal says what it is, not the client
    }
    // Not stored when the client, the checked seal, or even an unchecked seal calls it a protocol: never more than asked for.
    const claimed = seal && seal.match(SEAL_RE);
    if (consented && ![kind, rec.kind, claimed && claimed[2]].some((k) => NO_CONTENT.has(k))) rec.content = input.content;
    // checked by hash: keep the hash, and whether the content sent along is the very option it stands for, so a reviewer
    // sees more than "some sealed option exists"
    if (hash !== undefined && rec.sealOk !== null) { rec.optionHash = hash; if (rec.content !== undefined) rec.contentOk = optionHash(rec.content) === hash; }
    // a free card (lib/duell-deck.mjs): keep the checked hash, it is the card's id there; never content
    if (rec.kind === 'karte' && rec.sealOk && rec.optionHash === undefined) rec.optionHash = hash !== undefined ? hash : optionHash(sealed);
    if (!kind && !link && !seal && rec.content === undefined) return out(400, { error: 'bad-request' });   // nothing to look at
    // a generated picture (lib/duell-bild.mjs): its id, so the reviewer can open it; the picture service for everyone after a severe report or enough reporters
    // holds it for everyone after a severe report or enough reporters. With a valid seal the sealed id; without a seal (the
    // recipient of a link has only the id) an id the picture service knows; a seal that does not fit holds nothing.
    const bildOf = (o) => (o && typeof o === 'object' && typeof o.bild === 'string' && /^[A-Za-z0-9_-]{22}$/.test(o.bild) ? o.bild : null);
    let bildId = null;
    if (onBild && rec.kind === 'bild' && rec.sealOk) bildId = bildOf(sealed);
    else if (onBild && kind === 'bild' && rec.sealOk === null) { const c = bildOf(input.option) || bildOf(input.content); if (c && onBild.known && onBild.known(c)) bildId = c; }
    if (bildId) { rec.bild = bildId; rec.kind = 'bild'; }
    try { appendFileSync(file, JSON.stringify(rec) + '\n', { mode: 0o600, flush: true }); }
    catch (e) { log({ event: 'duell-report-write-failed', why: String(e && e.message || e).slice(0, 120) }); return out(503, { error: 'storage-failed' }); }
    reports.set(rec.id, rec);
    daily.n++;
    if (who) { hits.get(who).push(t); if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < HOUR)) hits.delete(k); }
    if (shared.metric) shared.metric(kind || 'unknown', 'report', 0);
    // the reporter's request goes along: only reports of signed-in accounts count towards a provisional block there
    if (onBild && bildId) try { onBild.reported(bildId, rec.reason, who); } catch (e) { log({ event: 'duell-report-bild-failed', why: String(e && e.message || e).slice(0, 120) }); }
    if (onCard && rec.kind === 'karte' && rec.sealOk) Promise.resolve().then(() => onCard.onReport(rec.optionHash, req)).catch((e) => log({ event: 'duell-report-card-failed', why: String(e && e.message || e).slice(0, 120) }));
    return out(202, { id: rec.id });
  }

  /** Pure core of POST /api/duell/report/<id>. The content leaves the file with the decision. */
  function decide(id, action) {
    if (!ok) return out(503, { error: 'storage-off' });
    expire();
    const r = reports.get(id);
    if (!r) return out(404, { error: 'unknown' });
    if (action !== 'dismiss' && action !== 'block') return out(400, { error: 'bad-action' });
    if (r.state !== 'open') return out(409, { error: 'closed', action: r.action });
    let linkBlocked = null;
    if (action === 'block' && r.link) linkBlocked = blockLink(r.link).status === 204;
    const done = { ...r, state: 'closed', action, closedAt: new Date(now()).toISOString(), linkBlocked };
    delete done.content;
    reports.set(id, done);
    try { compact(); }
    catch (e) { reports.set(id, r); log({ event: 'duell-report-write-failed', why: String(e && e.message || e).slice(0, 120) }); return out(503, { error: 'storage-failed' }); }
    if (onBild && r.kind === 'bild' && r.bild) try { onBild.decided(r.bild, action); } catch (e) { log({ event: 'duell-report-bild-failed', why: String(e && e.message || e).slice(0, 120) }); }
    if (onCard && r.kind === 'karte' && r.sealOk && r.optionHash) try { onCard.onDecide(r.optionHash, action); } catch (e) { log({ event: 'duell-report-card-failed', why: String(e && e.message || e).slice(0, 120) }); }
    return out(200, { id, action, linkBlocked });
  }
  const open = () => { expire(); return [...reports.values()].filter((r) => r.state === 'open').slice(0, 200); };

  function adminOk(req) {
    if (!cfg.admin) return false;
    const m = String(req.headers.authorization || '').match(/^Bearer (\S{16,200})$/);
    if (!m) return false;
    return timingSafeEqual(createHash('sha256').update(m[1]).digest(), cfg.admin);
  }
  const sendRaw = (res, r) => { res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...r.headers }); res.end(JSON.stringify(r.body)); };

  /** Returns true when the request was ours. Public (report, seal) and token-only (reviewer) routes, all before the login gate. */
  async function route(req, res, url) {
    const p = url.pathname;
    if (p === '/api/duell/seal') {
      const { cors, json } = await shared.readJson(req, res, 'POST, OPTIONS', CONTENT_MAX + 512);
      if (json === undefined) return true;
      const v = !json || typeof json !== 'object' ? { valid: false }
        : json.content === undefined && typeof json.optionHash === 'string' ? shared.sealer.verifyHash(json.seal, json.optionHash) : shared.sealer.verify(json.seal, json.content);
      shared.send(res, 200, v, cors.headers); return true;
    }
    const admin = p === '/api/duell/metrics' || (p === '/api/duell/report' && req.method === 'GET') || p.startsWith('/api/duell/report/');
    if (admin) {
      if (!cfg.admin) { req.resume(); sendRaw(res, out(503, { error: 'admin-off' })); return true; }
      if (!adminOk(req)) { req.resume(); sendRaw(res, out(401, { error: 'token' }, { 'WWW-Authenticate': 'Bearer' })); return true; }
      if (p === '/api/duell/metrics') { req.resume(); sendRaw(res, out(200, { ...shared.metrics.read(), queue: shared.queue.stats() })); return true; }
      if (p === '/api/duell/report') { req.resume(); sendRaw(res, out(200, { open: open() })); return true; }
      const { json } = await shared.readJson(req, res, 'POST');
      if (json === undefined) return true;
      sendRaw(res, decide(p.slice('/api/duell/report/'.length), json && json.action)); return true;
    }
    if (p === '/api/duell/report') {
      const { cors, json } = await shared.readJson(req, res, 'POST, OPTIONS', 2 * CONTENT_MAX + 1024);   // option and content
      if (json === undefined) return true;
      const r = report(json, shared.clientKey(req), req);
      shared.send(res, r.status, r.body, { ...cors.headers, ...r.headers }); return true;
    }
    return false;
  }

  load();
  expire();
  // Without traffic content must not outlive its period either; unref: the timer never keeps the process alive.
  const timer = ok && cfg.expireEveryMs > 0 ? setInterval(expire, cfg.expireEveryMs) : null;
  if (timer && timer.unref) timer.unref();
  return { route, report, decide, open, cfg, enabled: () => ok, stop: () => clearInterval(timer), _file: () => file };
}
