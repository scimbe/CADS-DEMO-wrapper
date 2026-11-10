// My Daily Idea: push notifications as a wake-up signal only (Web Push, RFC 8030 / 8291 / 8292).
//
//   GET  /api/duell/push/key           { on, key }  the VAPID public key (on: false when the server has no key)
//   POST /api/duell/push/subscribe     { sub: { endpoint, keys: { p256dh, auth } }, mark?, del? } -> { mark, del, days }
//   POST /api/duell/push/unsubscribe   { mark, del } -> 200 { ok } (also when the mark is unknown)
//   POST /api/duell/push/wake          { mark, r } -> 202 { ok }  (always the same answer: nobody learns whether a mark exists)
//   GET  /duell/push-sw.js             the page's service worker (apps/duell-web dist/push-sw.js), scope /duell
//
// One protocol for every channel that speaks Web Push: browsers (Chrome, Edge, Firefox, Safari; iOS from 16.4 only as a web
// app on the home screen) and UnifiedPush distributors on Android without Google (ntfy). FCM and APNs for the native apps
// come later as further channels of the same table; they need accounts (see the plan in the PR).
//
// What a push carries: only the kind of event, end-to-end encrypted to the device (aes128gcm): {"r":"reply"} or {"r":"live"}.
// No name, no text, no link. The device writes the sentence in its own language. The push service sees endpoint, time, size.
// Kinds are a closed list (KINDS). There is no kind for reminders, streaks, scarcity or marketing, and no route that sends
// to everybody: a push only ever goes to the one mark somebody answered.
//
// Addressing without an account: subscribing gives the device a mark (random, 128 bit) and a delete key. The person puts the
// mark into the link they send; whoever answers posts { mark, r }. Knowing a mark lets you wake that device, nothing else, and
// only within the limits below. A mark expires DUELL_PUSH_DAYS (30) days after its last renewal; the page renews on open.
//
// Limits: per mark DUELL_PUSH_MARK_PER_HOUR (6) and DUELL_PUSH_MARK_PER_DAY (20), per sender (salted IP hash, never stored)
// DUELL_PUSH_SENDER_PER_HOUR (30), subscriptions per sender and hour DUELL_PUSH_SUB_PER_HOUR (20), all sends per day
// DUELL_PUSH_DAILY_MAX (5000). An endpoint must be https on a known push host (PUSH_HOSTS, plus DUELL_PUSH_HOSTS for a
// self-hosted UnifiedPush server): the server never posts to an address a visitor chose, so it cannot be used for SSRF.
// A 404/410 from the push service removes the subscription. Nothing about marks or endpoints is logged.
//
// Keys: DUELL_VAPID_PUBLIC (uncompressed P-256 point, base64url), DUELL_VAPID_PRIVATE (32 bytes, base64url), DUELL_VAPID_SUBJECT
// (mailto: or https:). Made once with `node bin/duell-vapid.mjs`; they live in the environment, never in the repository.
// Without them every route answers "off" and nothing is stored. Storage: DUELL_PUSH_FILE (default push.json next to
// DUELL_AI_STATE_FILE), written atomically (tmp + rename), debounced; only mark, endpoint, the device's two public keys, a hash
// of the delete key and two timestamps.

import { createCipheriv, createECDH, createHash, createHmac, createPrivateKey, randomBytes, sign as signData, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const KINDS = ['reply', 'live'];
export const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', '.notify.windows.com'];
const MARK_RE = /^[A-Za-z0-9_-]{22}$/, DEL_RE = /^[A-Za-z0-9_-]{22,64}$/, B64U = /^[A-Za-z0-9_-]+$/;
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const unb64u = (s) => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const sha = (s) => createHash('sha256').update(String(s)).digest('base64url');

/** A fresh VAPID key pair: { publicKey, privateKey } as base64url (65-byte point, 32-byte scalar). */
export function vapidKeys() {
  const e = createECDH('prime256v1'); e.generateKeys();
  return { publicKey: b64u(e.getPublicKey()), privateKey: b64u(e.getPrivateKey()) };
}

function privateKeyObject(pub, priv) {
  const p = unb64u(pub), d = unb64u(priv);
  if (p.length !== 65 || p[0] !== 4 || d.length !== 32) throw new Error('vapid key');
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33)), d: b64u(d) }, format: 'jwk' });
}

/** RFC 8292: the Authorization header for one endpoint. exp at most 24 h ahead (we take 12 h). */
export function vapidHeader({ endpoint, publicKey, keyObject, subject, now = Date.now() }) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = signData('sha256', Buffer.from(head + '.' + body), { key: keyObject, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}

/** RFC 8291 (aes128gcm): encrypts `plain` for the device keys. Returns the full body (header + one record). */
export function encrypt(plain, p256dh, auth, { salt = randomBytes(16), ecdh } = {}) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (ua.length !== 65 || ua[0] !== 4 || secret.length !== 16) throw new Error('device keys');
  const as = ecdh || createECDH('prime256v1'); if (!ecdh) as.generateKeys();
  const asPub = as.getPublicKey(), shared = as.computeSecret(ua);
  const ikm = hmac(hmac(secret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([c.update(Buffer.concat([Buffer.from(plain), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, asPub, sealed]);
}

/** Whether the server may post to this endpoint: https, default port, no credentials, host on the list. */
export function endpointOk(endpoint, extraHosts = []) {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  let u; try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return [...PUSH_HOSTS, ...extraHosts].some((x) => (x.startsWith('.') ? h.endsWith(x) && h.length > x.length : h === x));
}

export function pushConfig(env = process.env) {
  return {
    publicKey: env.DUELL_VAPID_PUBLIC || '', privateKey: env.DUELL_VAPID_PRIVATE || '', subject: env.DUELL_VAPID_SUBJECT || '',
    hosts: String(env.DUELL_PUSH_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    days: num(env.DUELL_PUSH_DAYS, 30), markHour: num(env.DUELL_PUSH_MARK_PER_HOUR, 6), markDay: num(env.DUELL_PUSH_MARK_PER_DAY, 20),
    senderHour: num(env.DUELL_PUSH_SENDER_PER_HOUR, 30), subHour: num(env.DUELL_PUSH_SUB_PER_HOUR, 20), dailyMax: num(env.DUELL_PUSH_DAILY_MAX, 5000),
    ttl: num(env.DUELL_PUSH_TTL, 86400),
  };
}

export function createPush({ env = process.env, shared, webFile = '', fetchImpl = fetch, now = () => Date.now(), file, log = (o) => console.log(JSON.stringify(o)) } = {}) {
  const cfg = pushConfig(env);
  let keyObject = null;
  if (cfg.publicKey || cfg.privateKey) {
    try { keyObject = privateKeyObject(cfg.publicKey, cfg.privateKey); } catch { log({ event: 'duell-push-config', note: 'DUELL_VAPID_PUBLIC/PRIVATE invalid: push off' }); }
    if (keyObject && !/^(mailto:|https:)/.test(cfg.subject)) { keyObject = null; log({ event: 'duell-push-config', note: 'DUELL_VAPID_SUBJECT must be mailto: or https:, push off' }); }
  }
  const on = () => !!keyObject;
  const path = file !== undefined ? file : env.DUELL_PUSH_FILE || (env.DUELL_AI_STATE_FILE ? dirname(env.DUELL_AI_STATE_FILE) + '/push.json' : '');

  // mark -> { e: endpoint, p: p256dh, a: auth, d: sha(delete key), at: renewed, w: [wake times] }
  const subs = new Map(), byEndpoint = new Map(), senders = new Map(), subscribers = new Map(), daily = { day: '', n: 0 };
  if (path && existsSync(path)) {
    try {
      for (const [m, s] of Object.entries(JSON.parse(readFileSync(path, 'utf8')).subs || {})) if (MARK_RE.test(m) && s && typeof s.e === 'string') { subs.set(m, { ...s, w: [] }); byEndpoint.set(s.e, m); }
    } catch { log({ event: 'duell-push-store', note: 'unreadable, starting empty' }); }
  }
  let timer = null;
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!path) return;
    const out = {}; for (const [m, s] of subs) out[m] = { e: s.e, p: s.p, a: s.a, d: s.d, at: s.at };
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + '.tmp'; writeFileSync(tmp, JSON.stringify({ v: 1, subs: out })); renameSync(tmp, path);
  }
  const dirty = () => { if (path && !timer) { timer = setTimeout(flush, 2000); timer.unref?.(); } };
  const drop = (m) => { const s = subs.get(m); if (!s) return; subs.delete(m); byEndpoint.delete(s.e); dirty(); };
  const alive = (s, t) => t - s.at < cfg.days * 86400000;
  const within = (map, key, per, windowMs, t) => {
    const arr = (map.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length >= per) { map.set(key, arr); return false; }
    arr.push(t); map.set(key, arr); if (map.size > 20000) map.clear(); return true;
  };

  /** Subscribe or renew. A renewal (mark + del) keeps the mark the person already gave away. */
  function subscribe(body, who) {
    if (!on()) return { status: 503, body: { error: 'off' } };
    const sub = body && body.sub, keys = sub && sub.keys;
    if (!sub || !keys || !endpointOk(sub.endpoint, cfg.hosts)) return { status: 400, body: { error: 'endpoint' } };
    const p = String(keys.p256dh || ''), a = String(keys.auth || '');
    if (!B64U.test(p) || !B64U.test(a) || unb64u(p).length !== 65 || unb64u(p)[0] !== 4 || unb64u(a).length !== 16) return { status: 400, body: { error: 'keys' } };
    const t = now();
    if (who && !within(subscribers, who, cfg.subHour, 3600000, t)) return { status: 429, body: { error: 'rate-limited' } };
    let mark = null, del = null;
    if (MARK_RE.test(String(body.mark || '')) && DEL_RE.test(String(body.del || ''))) {
      const old = subs.get(body.mark);
      if (old && safeEq(old.d, sha(body.del))) { mark = body.mark; del = body.del; byEndpoint.delete(old.e); }
    }
    const other = byEndpoint.get(sub.endpoint); if (other && other !== mark) drop(other);   // one mark per endpoint
    if (!mark) { mark = b64u(randomBytes(16)); del = b64u(randomBytes(24)); }
    const prev = subs.get(mark);
    subs.set(mark, { e: sub.endpoint, p, a, d: sha(del), at: t, w: prev ? prev.w : [] }); byEndpoint.set(sub.endpoint, mark); dirty();
    return { status: 200, body: { mark, del, days: cfg.days } };
  }

  function unsubscribe(body) {
    const m = String(body && body.mark || ''), s = subs.get(m);
    if (s && safeEq(s.d, sha(String(body.del || '')))) drop(m);
    return { status: 200, body: { ok: true } };
  }

  /** Wakes the device behind a mark. Answers 202 whether or not the mark exists, is limited or expired. */
  async function wake(body, who) {
    if (!on()) return { status: 503, body: { error: 'off' } };
    const m = String(body && body.mark || ''), r = String(body && body.r || '');
    if (!MARK_RE.test(m) || !KINDS.includes(r)) return { status: 400, body: { error: 'bad-request' } };
    const t = now();
    if (who && !within(senders, who, cfg.senderHour, 3600000, t)) return { status: 429, body: { error: 'rate-limited' } };
    const quiet = { status: 202, body: { ok: true } }, s = subs.get(m);
    if (!s) return quiet;
    if (!alive(s, t)) { drop(m); return quiet; }
    s.w = s.w.filter((x) => t - x < 86400000);
    if (s.w.length >= cfg.markDay || s.w.filter((x) => t - x < 3600000).length >= cfg.markHour) return quiet;
    const today = new Date(t).toISOString().slice(0, 10);
    if (daily.day !== today) { daily.day = today; daily.n = 0; }
    if (daily.n >= cfg.dailyMax) return quiet;
    daily.n++; s.w.push(t);
    const outcome = await deliver(s, r, t);
    if (outcome === 'gone') drop(m);
    log({ event: 'duell-push', r, outcome });
    if (shared && shared.metric) try { shared.metric('push', outcome); } catch { /* metrics are optional */ }
    return quiet;
  }

  async function deliver(s, r, t) {
    try {
      const res = await fetchImpl(s.e, {
        method: 'POST',
        headers: {
          Authorization: vapidHeader({ endpoint: s.e, publicKey: cfg.publicKey, keyObject, subject: cfg.subject, now: t }),
          'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
          TTL: String(cfg.ttl), Urgency: 'normal', Topic: 'mdi-' + r,   // a newer push of the same kind replaces a waiting one
        },
        body: encrypt(JSON.stringify({ r }), s.p, s.a),
        signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      if (res.status === 404 || res.status === 410) return 'gone';
      return res.status >= 200 && res.status < 300 ? 'sent' : 'refused-' + res.status;
    } catch { return 'error'; }
  }

  async function serveWorker(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const f = webFile ? join(dirname(webFile), 'push-sw.js') : '';
    let st = null; try { st = f ? statSync(f) : null; } catch { st = null; }
    if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }).end('duell: no service worker'); return; }
    // The worker sits in /duell/ but the page is /duell (no slash): the header widens its allowed scope to exactly that.
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/duell', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(st.size) });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(f).pipe(res);
  }

  const reply = (res, out, cors) => shared.send(res, out.status, out.body, cors.headers);
  /** Returns true when the request was ours. Public by design: a mark is the only address and the limits above hold. */
  async function route(req, res, url) {
    const p = url.pathname;
    if (p === '/duell/push-sw.js') { await serveWorker(req, res); return true; }
    if (!p.startsWith('/api/duell/push/')) return false;
    const sub = p.slice('/api/duell/push/'.length);
    if (sub === 'key') {
      const cors = shared.corsFor(req);
      if (req.method !== 'GET') { shared.send(res, 405, { error: 'method' }, { ...cors.headers, Allow: 'GET' }); return true; }
      shared.send(res, 200, on() ? { on: true, key: cfg.publicKey } : { on: false }, cors.headers); return true;
    }
    if (!['subscribe', 'unsubscribe', 'wake'].includes(sub)) return false;
    const { cors, json } = await shared.readJson(req, res);
    if (json === undefined) return true;
    const who = shared.clientKey(req);
    if (sub === 'subscribe') reply(res, subscribe(json, who), cors);
    else if (sub === 'unsubscribe') reply(res, unsubscribe(json), cors);
    else reply(res, await wake(json, who), cors);
    return true;
  }

  return { route, subscribe, unsubscribe, wake, flush, on, cfg, _state: { subs } };
}

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
