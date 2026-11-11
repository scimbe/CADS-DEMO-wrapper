// Push as a wake-up signal: a local push service checks what a real one checks (VAPID JWT, ES256 against the public key,
// aud, exp) and decrypts the body the way a browser does (RFC 8291). The payload must be exactly the kind, nothing more.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPush, encrypt, endpointOk, vapidKeys, KINDS, b64u, unb64u } from '../lib/duell-push.mjs';
import { createDuell } from '../lib/duell.mjs';

const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const KEYS = vapidKeys();
const ENV = { DUELL_VAPID_PUBLIC: KEYS.publicKey, DUELL_VAPID_PRIVATE: KEYS.privateKey, DUELL_VAPID_SUBJECT: 'mailto:test@example.org' };

/** A browser's push subscription: its own ECDH key pair and auth secret. decrypt() undoes RFC 8291. */
function device(endpoint = 'https://fcm.googleapis.com/fcm/send/dev-' + b64u(randomBytes(6))) {
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const auth = randomBytes(16);
  return {
    sub: { endpoint, keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } },
    decrypt(body) {
      const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
      assert.equal(rs, 4096); assert.equal(idlen, 65);
      const ikm = hmac(hmac(auth, ua.computeSecret(asPub)), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub, Buffer.from([1])]));
      const prk = hmac(salt, ikm);
      const d = createDecipheriv('aes-128-gcm', hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12));
      d.setAuthTag(data.subarray(data.length - 16));
      const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
      assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
      return plain.subarray(0, plain.length - 1).toString('utf8');
    },
  };
}

/** The local push service: verifies VAPID like FCM/Mozilla do, records what arrived, answers with `status`. */
function pushService({ status = 201, now = Date.now() } = {}) {
  const got = [];
  const fetchImpl = async (url, init) => {
    const auth = String(init.headers.Authorization), m = auth.match(/^vapid t=([^,]+), k=(\S+)$/);
    assert.ok(m, 'vapid header');
    const [h, c, s] = m[1].split('.');
    assert.deepEqual(JSON.parse(unb64u(h)), { typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(unb64u(c));
    assert.equal(claims.aud, new URL(url).origin);
    assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 86400, 'exp within 24 h');
    assert.match(claims.sub, /^mailto:/);
    const pub = unb64u(m[2]);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
    assert.ok(verify('sha256', Buffer.from(h + '.' + c), { key, dsaEncoding: 'ieee-p1363' }, unb64u(s)), 'JWT signature');
    assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(init.redirect, 'error');
    got.push({ url, headers: init.headers, body: Buffer.from(init.body) });
    return { status };
  };
  return { got, fetchImpl };
}

const mk = (over = {}) => {
  const svc = pushService(over);
  const push = createPush({ env: { ...ENV, ...(over.env || {}) }, fetchImpl: svc.fetchImpl, file: '', log: () => {}, now: over.clock || (() => Date.now()) });
  return { svc, push };
};

test('Wecken: der Push-Dienst bekommt eine gültig signierte, verschlüsselte Nachricht, die genau die Art enthält', async () => {
  const { svc, push } = mk(), d = device();
  const s = push.subscribe({ sub: d.sub }, 'k1');
  assert.equal(s.status, 200);
  assert.match(s.body.mark, /^[A-Za-z0-9_-]{22}$/);
  assert.equal((await push.wake({ mark: s.body.mark, r: 'reply' }, 'k2')).status, 202);
  assert.equal(svc.got.length, 1);
  assert.equal(svc.got[0].url, d.sub.endpoint);
  assert.equal(d.decrypt(svc.got[0].body), '{"r":"reply"}');
  assert.equal(svc.got[0].headers.Topic, 'mdi-reply');
  // nothing in the clear: no mark, no kind in the encrypted body
  assert.ok(!svc.got[0].body.includes(Buffer.from('reply')) && !svc.got[0].body.includes(Buffer.from(s.body.mark)));
});

test('nur die festen Anlässe; kein Anlass für Erinnerung, Serie oder Werbung', async () => {
  assert.deepEqual(KINDS, ['reply', 'live']);
  const { svc, push } = mk(), m = push.subscribe({ sub: device().sub }).body.mark;
  for (const r of ['streak', 'reminder', 'promo', 'daily', '', 'REPLY']) assert.equal((await push.wake({ mark: m, r })).status, 400, r);
  assert.equal(svc.got.length, 0);
});

test('unbekannte, abgemeldete und abgelaufene Marken: gleiche Antwort, nichts wird gesendet', async () => {
  let t = Date.parse('2026-11-10T10:00:00Z');
  const { svc, push } = mk({ clock: () => t, now: t });
  const a = push.subscribe({ sub: device().sub }).body, b = push.subscribe({ sub: device().sub }).body;
  const unknown = await push.wake({ mark: b64u(randomBytes(16)), r: 'live' });
  assert.deepEqual(unknown, { status: 202, body: { ok: true } });
  assert.deepEqual(push.unsubscribe({ mark: a.mark, del: 'falsch-falsch-falsch-falsch' }), { status: 200, body: { ok: true } });
  assert.ok(push._state.subs.has(a.mark), 'wrong delete key removes nothing');
  push.unsubscribe({ mark: a.mark, del: a.del });
  assert.deepEqual(await push.wake({ mark: a.mark, r: 'live' }), unknown);
  t += 31 * 86400000;
  assert.deepEqual(await push.wake({ mark: b.mark, r: 'live' }), unknown);
  assert.equal(svc.got.length, 0);
  assert.equal(push._state.subs.size, 0);
});

test('Erneuern behält die Marke, die schon im Link steht; ein Endpunkt hat nur eine Marke', () => {
  const { push } = mk(), d = device();
  const first = push.subscribe({ sub: d.sub }).body;
  const renewed = push.subscribe({ sub: d.sub, mark: first.mark, del: first.del }).body;
  assert.equal(renewed.mark, first.mark);
  const fresh = push.subscribe({ sub: d.sub }).body;   // no delete key: a new mark, the old one is gone
  assert.notEqual(fresh.mark, first.mark);
  assert.deepEqual([...push._state.subs.keys()], [fresh.mark]);
});

test('Grenzen: je Marke pro Stunde, je Absender, Tagesbudget', async () => {
  const { svc, push } = mk({ env: { DUELL_PUSH_MARK_PER_HOUR: '2', DUELL_PUSH_SENDER_PER_HOUR: '3', DUELL_PUSH_DAILY_MAX: '3' } });
  const m1 = push.subscribe({ sub: device().sub }).body.mark, m2 = push.subscribe({ sub: device().sub }).body.mark;
  for (let i = 0; i < 3; i++) assert.equal((await push.wake({ mark: m1, r: 'reply' }, 'a' + i)).status, 202);
  assert.equal(svc.got.length, 2, 'third push to the same mark within the hour is dropped silently');
  assert.equal((await push.wake({ mark: m2, r: 'reply' }, 's')).status, 202);
  assert.equal((await push.wake({ mark: m2, r: 'reply' }, 'x')).status, 202);
  assert.equal(svc.got.length, 3, 'daily budget');
  for (let i = 0; i < 2; i++) await push.wake({ mark: m2, r: 'live' }, 's');
  assert.equal((await push.wake({ mark: m2, r: 'live' }, 's')).status, 429, 'sender limit');
});

test('410 vom Push-Dienst löscht die Anmeldung', async () => {
  const { svc, push } = mk({ status: 410 }), m = push.subscribe({ sub: device().sub }).body.mark;
  await push.wake({ mark: m, r: 'live' });
  assert.equal(svc.got.length, 1);
  assert.equal(push._state.subs.size, 0);
});

test('Endpunkte nur https auf bekannten Push-Hosts (kein SSRF), Schlüssel werden geprüft', () => {
  for (const e of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Q', 'https://db5p.notify.windows.com/w/?token=x']) assert.ok(endpointOk(e), e);
  for (const e of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x', 'https://localhost/x', 'https://169.254.169.254/latest', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://notify.windows.com/x', 'file:///etc/passwd'])
    assert.ok(!endpointOk(e), e);
  assert.ok(endpointOk('https://ntfy.example.org/up123', ['ntfy.example.org']), 'self-hosted UnifiedPush when configured');
  const { push } = mk();
  assert.equal(push.subscribe({ sub: device('https://169.254.169.254/x').sub }).status, 400);
  const bad = device().sub; bad.keys.auth = b64u(randomBytes(8));
  assert.equal(push.subscribe({ sub: bad }).status, 400);
});

test('ohne VAPID-Schlüssel ist alles aus und es wird nichts gespeichert', async () => {
  const push = createPush({ env: {}, file: '', log: () => {} });
  assert.equal(push.on(), false);
  assert.equal(push.subscribe({ sub: device().sub }).status, 503);
  assert.equal((await push.wake({ mark: b64u(randomBytes(16)), r: 'reply' })).status, 503);
  const half = createPush({ env: { ...ENV, DUELL_VAPID_SUBJECT: 'betrieb' }, file: '', log: () => {} });
  assert.equal(half.on(), false, 'subject must be mailto: or https:');
});

test('Speicher: atomar, nur Marke, Endpunkt, öffentliche Geräteschlüssel, Hash des Löschschlüssels; überlebt Neustart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-')), file = join(dir, 'push.json');
  try {
    const svc = pushService(), d = device();
    const a = createPush({ env: ENV, fetchImpl: svc.fetchImpl, file, log: () => {} });
    const s = a.subscribe({ sub: d.sub }).body; a.flush();
    const raw = readFileSync(file, 'utf8');
    assert.ok(!raw.includes(s.del), 'delete key is stored only as a hash');
    assert.deepEqual(Object.keys(JSON.parse(raw).subs[s.mark]).sort(), ['a', 'at', 'd', 'e', 'p']);
    const b = createPush({ env: ENV, fetchImpl: svc.fetchImpl, file, log: () => {} });
    await b.wake({ mark: s.mark, r: 'live' });
    assert.equal(d.decrypt(svc.got[0].body), '{"r":"live"}');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('encrypt passt zu RFC 8291 Anhang A (fester Schlüssel und Salt)', () => {
  // Test vector from RFC 8291, Appendix A.
  const asPriv = unb64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), salt = unb64u('DGv6ra1nlYgDCS1FRnbzlw');
  const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(asPriv);
  const body = encrypt('When I grow up, I want to be a watermelon', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', { salt, ecdh });
  assert.equal(b64u(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('HTTP: Routen hinter dem echten Server-Gerüst (CORS, JSON, Service Worker mit erweitertem Scope)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pushweb-')), web = join(dir, 'dist', 'index.html');
  mkdirSync(join(dir, 'dist')); writeFileSync(web, '<!doctype html>'); writeFileSync(join(dir, 'dist', 'push-sw.js'), 'self.addEventListener("push",()=>{});');
  const duell = createDuell({ env: {}, log: () => {} });
  const svc = pushService(), d = device();
  const push = createPush({ env: ENV, shared: duell.shared, webFile: web, fetchImpl: svc.fetchImpl, file: '', log: () => {} });
  const server = http.createServer(async (req, res) => { if (!(await push.route(req, res, new URL(req.url, 'http://x')))) res.writeHead(404).end(); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.deepEqual(await (await fetch(base + '/api/duell/push/key')).json(), { on: true, key: KEYS.publicKey });
    const s = await (await post('/api/duell/push/subscribe', { sub: d.sub })).json();
    assert.equal((await post('/api/duell/push/wake', { mark: s.mark, r: 'reply' })).status, 202);
    assert.equal(d.decrypt(svc.got[0].body), '{"r":"reply"}');
    assert.equal((await post('/api/duell/push/wake', { mark: s.mark, r: 'reply' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(base + '/api/duell/push/wake', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    const sw = await fetch(base + '/duell/push-sw.js');
    assert.equal(sw.status, 200);
    assert.equal(sw.headers.get('service-worker-allowed'), '/duell');
    assert.match(sw.headers.get('content-type'), /javascript/);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('bin/duell-vapid.mjs schreibt die Schlüssel nur in eine Datei mit Modus 600 und gibt den privaten Schlüssel nicht aus', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vapid-')), out = join(dir, 'v.env');
  try {
    const stdout = execFileSync(process.execPath, [new URL('../bin/duell-vapid.mjs', import.meta.url).pathname, 'mailto:ops@example.org', out], { encoding: 'utf8' });
    const env = Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
    assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.ok(!stdout.includes(env.DUELL_VAPID_PRIVATE));
    assert.equal(createPush({ env, file: '', log: () => {} }).on(), true);
    assert.throws(() => execFileSync(process.execPath, [new URL('../bin/duell-vapid.mjs', import.meta.url).pathname, 'mailto:ops@example.org', out], { stdio: 'pipe' }), 'refuses to overwrite');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
