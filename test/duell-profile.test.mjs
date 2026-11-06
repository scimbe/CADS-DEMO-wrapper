// My Daily Idea profile: account only with 16+, sync code without account, no photos, delete, expiry, HTTP rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createDuellProfile, cleanProfile, LIMITS } from '../lib/duell-profile.mjs';

const CODE = 'c0ffee'.padEnd(32, '0'), CODE2 = 'b'.repeat(32), DEV = 'd'.repeat(32);
const TH = 'data:image/jpeg;base64,' + 'A'.repeat(200);
const dir = () => mkdtempSync(join(tmpdir(), 'duell-profile-'));
const gate = (email, error) => ({ mode: 'gate', identify: async () => (error ? { error: true } : { email }), loginUrl: (r) => 'https://bunsenbrenner.org/gate/start?return=' + encodeURIComponent(r) });
const mk = ({ env = {}, auth = gate(null), now } = {}) => {
  const d = createDuell({ env: {}, salt: 's', log: () => {} });
  return createDuellProfile({ env: { DUELL_PROFILE_DIR: dir(), DUELL_PROFILE_SALT: 'x', ...env }, auth, shared: d.shared, log: () => {}, ...(now ? { now } : {}) });
};
const PROFILE = {
  me: { nick: 'Mira', emoji: '🐸', colors: ['#FFD400', '#ff3b1d'], set: 'tiere' },
  wall: [{ id: 'quiz-chaos', ts: 1762164000000, k: 'card', th: TH }, { id: 'selfie-poster', ts: 1762164000001, k: 'photo', th: TH }],
  saved: [{ id: 'quiz-chaos', ts: 1762164000000 }],
  ai: { dev: DEV, proof: '1a' },
};

test('cleanProfile: Merken-Link f bleibt (nur c=-Fragment bis 1200 Zeichen), alles andere in f faellt weg', () => {
  const w = (f) => cleanProfile({ wall: [{ id: 'own', ts: 5, k: 'card', th: TH, f }] }).wall[0];
  assert.equal(w('c=eyJrIjoiY2FyZCJ9').f, 'c=eyJrIjoiY2FyZCJ9', 'kept');
  assert.equal(w('c=' + 'A'.repeat(1198)).f.length, 1200);
  for (const bad of ['c=' + 'A'.repeat(1199), 'i=quiz-chaos', 'c=a b', 'c=<x>', 'https://x/#c=aa', 5, null]) assert.equal(w(bad).f, undefined, String(bad).slice(0, 20));
  assert.deepEqual(Object.keys(w('c=aa')).sort(), ['f', 'id', 'k', 'th', 'ts']);
  assert.equal(cleanProfile({ wall: [{ id: 'own', ts: 5, k: 'photo', th: TH, f: 'c=aa' }] }).wall.length, 0, 'a photo work with a link stays out too');
});

test('cleanProfile: Fotos, fremde Felder, Kontaktdaten und kaputte Werte fallen weg', () => {
  const p = cleanProfile({ ...PROFILE, email: 'x@y.de', ip: '1.2.3.4', me: { ...PROFILE.me, extra: 1 } }, 'code');
  assert.deepEqual(Object.keys(p).sort(), ['ai', 'me', 'saved', 'v', 'wall']);
  assert.deepEqual(p.me, { nick: 'Mira', emoji: '🐸', colors: ['#ffd400', '#ff3b1d'], set: 'tiere' });
  assert.deepEqual(p.wall.map((e) => e.k), ['card'], 'kind photo is never stored');
  assert.equal(cleanProfile({ wall: [{ id: 'a', ts: 1, th: TH }] }).wall.length, 0, 'an entry without kind could be a photo: dropped');
  assert.equal(cleanProfile({ wall: [{ id: 'a', ts: 1, k: 'card', th: 'data:image/png;base64,AAAA' }] }).wall.length, 0);
  assert.equal(cleanProfile({ wall: [{ id: 'a', ts: 1, k: 'card', th: 'data:image/jpeg;base64,' + 'A'.repeat(LIMITS.thumb) }] }).wall.length, 0);
  assert.equal(cleanProfile({ me: { nick: 'mira@example.org' } }).me.nick, '', 'no contact data in the nickname');
  assert.equal(cleanProfile({ me: { nick: 'ruf 0170 1234567' } }).me.nick, '');
  assert.equal(cleanProfile({ me: { nick: 'fuck' } }).me.nick, '', 'word filter');
  assert.equal(cleanProfile({ me: { colors: ['red', 'blue'] } }).me.colors, null);
  assert.equal(cleanProfile(PROFILE, 'account').ai, undefined, 'an account has its allowance on the server already');
  const many = Array.from({ length: 300 }, (_, i) => ({ id: 'id-' + i, ts: i + 1 }));
  assert.equal(cleanProfile({ saved: many.concat(many) }).saved.length, LIMITS.saved);
});

test('Sync-Code: anlegen, lesen, Revision, Loeschen; auf der Platte nur HMAC-Dateiname, kein Code', async () => {
  const s = mk();
  assert.deepEqual((await s.handle('get', { via: 'code', code: CODE })).body, { profile: null, rev: 0, via: 'code' });
  const put = await s.handle('put', { via: 'code', code: CODE, rev: 0, profile: PROFILE });
  assert.equal(put.status, 200); assert.equal(put.body.rev, 1);
  const got = (await s.handle('get', { via: 'code', code: CODE })).body;
  assert.equal(got.rev, 1); assert.equal(got.profile.me.nick, 'Mira'); assert.equal(got.profile.wall.length, 1); assert.deepEqual(got.profile.ai, { dev: DEV, proof: '1a' });
  assert.deepEqual((await s.handle('get', { via: 'code', code: CODE2 })).body.profile, null, 'another code sees nothing');
  const stale = await s.handle('put', { via: 'code', code: CODE, rev: 0, profile: PROFILE });
  assert.equal(stale.status, 409); assert.equal(stale.body.rev, 1);
  const files = readdirSync(s.cfg.dir);
  assert.equal(files.length, 1); assert.match(files[0], /^s[a-f0-9]{32}\.json$/);
  assert.equal(statSync(join(s.cfg.dir, files[0])).mode & 0o777, 0o600);
  const raw = readFileSync(join(s.cfg.dir, files[0]), 'utf8');
  assert.ok(!raw.includes(CODE) && !raw.includes('selfie'), 'neither the code nor the photo entry');
  assert.equal((await s.handle('delete', { via: 'code', code: CODE })).status, 200);
  const marker = readFileSync(join(s.cfg.dir, files[0]), 'utf8');
  assert.deepEqual(JSON.parse(marker), { r: 2, gone: true }, 'deleting removes the data at once, only an empty marker stays');
  assert.deepEqual((await s.handle('get', { via: 'code', code: CODE })).body, { profile: null, rev: 2, via: 'code', gone: true });
  assert.equal((await s.handle('put', { via: 'code', code: CODE, rev: 2, profile: PROFILE })).status, 410, 'a device that was linked does not upload it again');
  assert.equal((await s.handle('put', { via: 'code', code: CODE, rev: 2, profile: PROFILE, fresh: true })).body.rev, 3, 'linking anew starts it again');
  for (const bad of [{ via: 'code' }, { via: 'code', code: 'XYZ' }, { via: 'nope' }, null, []]) assert.equal((await s.handle('get', bad)).status, 400, JSON.stringify(bad));
});

test('Konto: nur angemeldet, erstes Speichern nur mit 16+, Tag der Angabe bleibt, keine E-Mail auf der Platte', async () => {
  const off = createDuellProfile({ env: { DUELL_PROFILE_DIR: dir() }, auth: { mode: 'off' }, shared: {}, log: () => {} });
  assert.equal((await off.handle('get', { via: 'account' }, {})).body.error, 'login-off');
  const anon = mk();
  const r = await anon.handle('get', { via: 'account' }, {});
  assert.equal(r.status, 401); assert.match(r.body.login_url, /return=%2Fduell$/);
  assert.equal((await mk({ auth: gate(null, true) }).handle('get', { via: 'account' }, {})).status, 503);
  const now = () => Date.parse('2026-11-03T10:00:00Z');
  const s = mk({ auth: gate('Mira@Example.org'), now });
  assert.equal((await s.handle('put', { via: 'account', rev: 0, profile: PROFILE }, {})).body.error, 'age16');
  assert.equal(readdirSync(s.cfg.dir).length, 0, 'nothing stored without the 16+ statement');
  assert.equal((await s.handle('put', { via: 'account', rev: 0, profile: PROFILE, age16: true }, {})).body.rev, 1);
  assert.equal((await s.handle('put', { via: 'account', rev: 1, profile: PROFILE }, {})).body.rev, 2, 'later writes need no repeat');
  const f = readdirSync(s.cfg.dir)[0], raw = readFileSync(join(s.cfg.dir, f), 'utf8');
  assert.match(f, /^a[a-f0-9]{32}\.json$/);
  assert.ok(!/example/i.test(raw), 'no e-mail');
  assert.equal(JSON.parse(raw).c, '2026-11-03');
  assert.equal(JSON.parse(raw).p.ai, undefined);
  assert.equal((await s.handle('get', { via: 'account' }, {})).body.profile.me.nick, 'Mira');
  assert.equal((await s.handle('delete', { via: 'account' }, {})).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(join(s.cfg.dir, f), 'utf8')), { r: 3, gone: true });
  assert.equal((await s.handle('put', { via: 'account', rev: 3, profile: PROFILE, fresh: true }, {})).body.error, 'age16', 'starting again needs the 16+ statement again');
});

test('Grenzen: neue Profile je IP und Stunde, Schreibrate, Obergrenze, ohne Verzeichnis 503', async () => {
  const s = mk({ env: { DUELL_PROFILE_IP_NEW_PER_HOUR: '2', DUELL_PROFILE_WRITES_PER_HOUR: '3' } });
  const code = (i) => String(i).padStart(32, '0');
  assert.equal((await s.handle('put', { via: 'code', code: code(1), rev: 0, profile: {} }, null, 'ip')).status, 200);
  assert.equal((await s.handle('put', { via: 'code', code: code(2), rev: 0, profile: {} }, null, 'ip')).status, 200);
  assert.equal((await s.handle('put', { via: 'code', code: code(3), rev: 0, profile: {} }, null, 'ip')).body.error, 'new-limit');
  assert.equal((await s.handle('put', { via: 'code', code: code(3), rev: 0, profile: {} }, null, 'other')).status, 200);
  for (let r = 1; r < 3; r++) assert.equal((await s.handle('put', { via: 'code', code: code(1), rev: r, profile: {} }, null, 'ip')).status, 200, 'updates are no new profiles');
  assert.equal((await s.handle('put', { via: 'code', code: code(1), rev: 3, profile: {} }, null, 'ip')).body.error, 'rate-limited');
  const full = mk({ env: { DUELL_PROFILE_MAX: '1' } });
  await full.handle('put', { via: 'code', code: code(1), rev: 0, profile: {} });
  assert.equal((await full.handle('put', { via: 'code', code: code(2), rev: 0, profile: {} })).body.error, 'full');
  const none = createDuellProfile({ env: {}, auth: gate(null), shared: {}, log: () => {} });
  assert.equal((await none.handle('get', { via: 'code', code: CODE })).status, 503);
});

test('Ablauf: ungenutzte Profile werden nach der Frist geloescht, Lesen haelt sie am Leben', async () => {
  let t = Date.parse('2026-11-03T10:00:00Z');
  const d = dir(), env = { DUELL_PROFILE_DIR: d, DUELL_PROFILE_TTL_DAYS: '10' };
  const s = mk({ env, now: () => t });
  await s.handle('put', { via: 'code', code: CODE, rev: 0, profile: PROFILE });
  await s.handle('put', { via: 'code', code: CODE2, rev: 0, profile: PROFILE });
  const old = new Date(t - 11 * 86400000);
  for (const f of readdirSync(d)) utimesSync(join(d, f), old, old);
  await s.handle('get', { via: 'code', code: CODE2 }); // read before the hourly sweep: CODE2 stays
  t += 2 * 3600000;
  await s.handle('get', { via: 'code', code: CODE2 });
  assert.equal((await s.handle('get', { via: 'code', code: CODE })).body.profile, null, 'expired');
  assert.equal((await s.handle('get', { via: 'code', code: CODE2 })).body.profile.me.nick, 'Mira', 'still in use');
  assert.equal(mk({ env, now: () => t })._count(), 1);
});

test('HTTP: POST mit JSON, CORS wie die anderen Duell-Routen, Groessengrenze, kein Cookie fremder Herkunft', async () => {
  const s = mk({ auth: gate('mira@example.org') });
  const srv = http.createServer((req, res) => s.route(req, res, new URL(req.url, 'http://x')).then((mine) => { if (!mine) res.writeHead(599).end(); }));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/api/duell/profile/other', { method: 'POST' })).status, 599, 'not ours');
    assert.equal((await fetch(base + '/api/duell/profile/get')).status, 405);
    assert.equal((await post('/api/duell/profile/get', 'x', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('/api/duell/profile/get', '{bad')).status, 400);
    assert.equal((await post('/api/duell/profile/get', { via: 'code', code: CODE }, { Origin: 'https://evil.example' })).status, 403);
    const android = await post('/api/duell/profile/put', { via: 'code', code: CODE, rev: 0, profile: PROFILE }, { Origin: 'https://appassets.androidplatform.net' });
    assert.equal(android.status, 200); assert.equal(android.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');
    assert.equal(android.headers.get('access-control-allow-credentials'), null, 'no cookies cross-origin');
    const pre = await fetch(base + '/api/duell/profile/put', { method: 'OPTIONS', headers: { Origin: 'https://appassets.androidplatform.net' } });
    assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
    const big = await post('/api/duell/profile/put', { via: 'code', code: CODE, rev: 1, profile: { pad: 'A'.repeat(LIMITS.body) } });
    assert.equal(big.status, 413);
    const acc = await post('/api/duell/profile/get', { via: 'account' });
    assert.equal(acc.status, 200); assert.equal((await acc.json()).via, 'account');
    assert.equal((await post('/api/duell/profile/delete', { via: 'code', code: CODE })).status, 200);
  } finally { srv.close(); srv.closeAllConnections(); }
});
