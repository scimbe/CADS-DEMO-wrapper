// Security review M2: POST /api/s needs no login and live there is no client IP. Limits per account or per device (with its
// proof of work), a cap on new devices, and a reserve of the day and of the store for accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShortLinks } from '../lib/shortlink.mjs';
import { deviceProofOk } from '../lib/duell-pots.mjs';

const F = 'i=quiz-chaos';
const HOUR = 3600000, DAY = 24 * HOUR;
const dir = () => mkdtempSync(join(tmpdir(), 'short-limits-'));
const dev = (n) => createHash('sha256').update('device ' + n).digest('hex').slice(0, 32);
/** The proof the app finds once per device (the same function as for AI actions). */
function proofFor(device, bits) {
  for (let i = 0; ; i++) { const p = i.toString(36); if (deviceProofOk(device, p, bits)) return p; }
}
/** A stand-in for lib/auth.mjs: the cookie "sess=<mail>" is that account; "gate=down" is an unreachable gate. */
const fakeAuth = { mode: 'gate', identify: async (req) => {
  const c = String(req.headers.cookie || '');
  if (c === 'gate=down') return { error: true };
  const m = /^sess=(.+)$/.exec(c);
  return { email: m ? m[1] : null };
} };
const mk = (env = {}, over = {}) => createShortLinks({ env: { SHORT_DATA_DIR: dir(), ...env }, log: () => {}, auth: fakeAuth, ...over });
function serve(s) {
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => s.route(req, res, new URL(req.url, 'http://x')).then((mine) => { if (!mine) res.writeHead(599).end(); }));
    srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.close(); srv.closeAllConnections(); } }));
  });
}
const post = (base, body, cookie) => fetch(base + '/api/s', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const D = (n) => ({ kind: 'd', key: 'dev-' + n, device: dev(n) });
const A = (n) => ({ kind: 'a', key: 'acct-' + n });

test('M2 http: without account and without device no short link; a device needs its proof (default 16 bits)', async () => {
  const s = mk(); const h = await serve(s);
  assert.deepEqual(await (await post(h.base, { f: F })).json(), { error: 'device-required' });
  assert.equal((await post(h.base, { f: F, device: 'kein-geraet' })).status, 400);
  assert.deepEqual(await (await post(h.base, { f: F, device: dev(1) })).json(), { error: 'proof' });
  assert.equal((await post(h.base, { f: F, device: dev(1), proof: 'falsch' })).status, 403);
  const proof = proofFor(dev(1), 16);
  assert.equal((await post(h.base, { f: F, device: dev(1), proof })).status, 201, 'the same proof as for AI actions');
  assert.equal((await post(h.base, { f: F, device: dev(1), proof })).status, 201, 'found once, valid for that device');
  assert.equal((await post(h.base, { f: F, device: dev(2), proof })).status, 403, 'a proof belongs to its device');
  // an account needs neither device nor proof; an unreachable gate is no account (the stricter device rules apply)
  assert.equal((await post(h.base, { f: F }, 'sess=lea@example.org')).status, 201);
  assert.deepEqual(await (await post(h.base, { f: F }, 'gate=down')).json(), { error: 'device-required' });
  assert.equal((await post(h.base, { f: F, device: dev(3), proof: proofFor(dev(3), 16) }, 'gate=down')).status, 201);
  h.close();
});

test('M2 core: the owner is required; a missing owner is a programming error, never "no limit"', () => {
  const s = mk();
  assert.throws(() => s.create({ f: F }), /owner required/);
  assert.throws(() => s.create({ f: F }, null, { kind: 'x', key: 'k' }), /owner required/);
});

test('M2 device: 5 an hour, 20 a day (defaults); another device or the next day is not affected', () => {
  let t = Date.UTC(2026, 10, 12, 8); const s = mk({ SHORT_PROOF_BITS: '0' }, { now: () => t });
  for (let i = 0; i < 5; i++) assert.equal(s.create({ f: F }, null, D(1)).status, 201, String(i));
  assert.deepEqual(s.create({ f: F }, null, D(1)).body, { error: 'owner-limit' });
  assert.equal(s.create({ f: F }, null, D(2)).status, 201, 'another device');
  for (let hr = 1; hr <= 3; hr++) { t += HOUR; for (let i = 0; i < 5; i++) assert.equal(s.create({ f: F }, null, D(1)).status, 201, `hour ${hr}`); }
  t += HOUR;
  assert.deepEqual(s.create({ f: F }, null, D(1)).body, { error: 'owner-limit' }, '20 within a day');
  t += DAY;
  assert.equal(s.create({ f: F }, null, D(1)).status, 201, 'a day later');
});

test('M2 account: 30 an hour, 200 a day (defaults), counted per account', () => {
  let t = Date.UTC(2026, 10, 12, 8); const s = mk({}, { now: () => t });
  for (let i = 0; i < 30; i++) assert.equal(s.create({ f: F }, null, A(1)).status, 201, String(i));
  assert.deepEqual(s.create({ f: F }, null, A(1)).body, { error: 'owner-limit' });
  assert.equal(s.create({ f: F }, null, A(2)).status, 201);
  for (let hr = 1; hr < 7; hr++) { t += HOUR; for (let i = 0; i < 30; i++) s.create({ f: F }, null, A(1)); }
  t += HOUR;
  assert.deepEqual(s.create({ f: F }, null, A(1)).body, { error: 'owner-limit' }, '200 within a day');
});

test('M2 new devices: at most SHORT_NEW_DEVICES_PER_HOUR fresh ids an hour; known devices go on; next hour opens again', () => {
  let t = Date.UTC(2026, 10, 12, 8, 5); const s = mk({ SHORT_PROOF_BITS: '0', SHORT_NEW_DEVICES_PER_HOUR: '3' }, { now: () => t });
  for (let n = 1; n <= 3; n++) assert.equal(s.create({ f: F }, null, D(n)).status, 201);
  assert.deepEqual(s.create({ f: F }, null, D(4)).body, { error: 'new-limit' });
  assert.equal(s.create({ f: F }, null, D(1)).status, 201, 'a device seen today is not new');
  assert.equal(s.create({ f: F }, null, A(1)).status, 201, 'accounts are not new devices');
  t += HOUR;
  assert.equal(s.create({ f: F }, null, D(4)).status, 201);
});

test('M2 reserve: fresh device ids cannot use up the day or the store; accounts keep their share', () => {
  let t = Date.UTC(2026, 10, 12, 8); const env = { SHORT_PROOF_BITS: '0', SHORT_DAILY_MAX: '10', SHORT_ACCOUNT_RESERVE_PCT: '50' };
  const s = mk(env, { now: () => t });
  // a script with ever new device ids: half of the day, then no more
  for (let n = 1; n <= 5; n++) assert.equal(s.create({ f: F }, null, D(n)).status, 201);
  assert.deepEqual(s.create({ f: F }, null, D(6)).body, { error: 'daily-limit' }, 'devices stop at 50 % of the day');
  for (let i = 0; i < 5; i++) assert.equal(s.create({ f: F }, null, A(1)).status, 201, 'the reserve is there for accounts');
  assert.deepEqual(s.create({ f: F }, null, A(2)).body, { error: 'daily-limit' }, 'the day is full for everybody at SHORT_DAILY_MAX');
  // the store: devices stop at 50 % of SHORT_MAX_LIVE, accounts fill the rest
  const s2 = mk({ SHORT_PROOF_BITS: '0', SHORT_MAX_LIVE: '8' }, { now: () => t });
  for (let n = 1; n <= 4; n++) assert.equal(s2.create({ f: F }, null, D(n)).status, 201);
  t += DAY;   // a new day: the daily total is not what stops them
  assert.deepEqual(s2.create({ f: F }, null, D(9)).body, { error: 'full' });
  for (let i = 0; i < 4; i++) assert.equal(s2.create({ f: F }, null, A(1)).status, 201);
  assert.deepEqual(s2.create({ f: F }, null, A(1)).body, { error: 'full' });
});

test('M2 storage: a record says only whether an account or a device made it; no device id, no account, no HMAC on disk', () => {
  const s = mk({ SHORT_PROOF_BITS: '0' });
  s.create({ f: F }, null, D(7)); s.create({ f: F }, null, { kind: 'a', key: 'secret-account-hmac' });
  const raw = readFileSync(s._file(), 'utf8');
  assert.deepEqual(raw.trim().split('\n').map((l) => JSON.parse(l).o), ['d', 'a']);
  assert.ok(!raw.includes(dev(7)) && !raw.includes('dev-7') && !raw.includes('secret-account-hmac'));
});
