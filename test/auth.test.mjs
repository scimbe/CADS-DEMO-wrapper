// Login gate: no identity -> 401 on every run endpoint while the gallery stays public; a client-sent
// X-Gate-Email is never trusted; the identity comes only from the gate's own answer; per-account rate limit.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createAuth } from '../lib/auth.mjs';

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const GOOD = 'valid-session-token', SHARE = 'share-session-token', UNGATED = 'ungated-token';
let stub, wrapper, base, gateCalls;

before(async () => {
  gateCalls = [];
  const gp = await freePort();
  stub = http.createServer((req, res) => {
    gateCalls.push({ cookie: req.headers.cookie, host: req.headers['x-forwarded-host'], spoof: req.headers['x-gate-email'] });
    const c = String(req.headers.cookie || '');
    if (c.includes(`ct_gate_session=${GOOD}`)) return res.writeHead(200, { 'X-Gate-Email': 'alice@example.org' }).end();
    if (c.includes(`ct_gate_session=${SHARE}`)) return res.writeHead(200, { 'X-Gate-Email': 'share:abc' }).end();
    if (c.includes(`ct_gate_session=${UNGATED}`)) return res.writeHead(200, { 'X-Gate-Email': '' }).end(); // host without require_login
    res.writeHead(302, { Location: 'https://bunsenbrenner.org/gate/start' }).end();
  });
  await new Promise((r) => stub.listen(gp, '127.0.0.1', r));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  wrapper = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', DEMO_AUTH_MODE: 'gate', DEMO_GATE_HOST: 'demos.example.org',
      DEMO_GATE_CHECK_URL: `http://127.0.0.1:${gp}/gate/check`, DEMO_RUNS_PER_HOUR: '3' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 8000);
    wrapper.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) { clearTimeout(to); resolve(); } });
    wrapper.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
});
after(() => { wrapper?.kill(); stub?.close(); });

const RUNS = [['GET', '/api/start?demo=x'], ['POST', '/api/start'], ['POST', '/api/plan?demo=x'], ['POST', '/api/upload-compare'], ['POST', '/api/podcast'], ['GET', '/api/anything-new']];

test('gallery, demo pages and status stay public (200) and carry the login banner', async () => {
  for (const p of ['/', '/api/status']) assert.equal((await fetch(base + p)).status, 200, p);
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /Mit bunsenbrenner-Konto anmelden/);
  assert.equal((await fetch(base + '/auth/me')).status, 200);
});

test('pages that run only in the browser carry no login banner, others keep it', async () => {
  for (const p of ['/d/untertitel', '/d/untertitel/', '/d/untertitel?lang=en']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.ok(!(await r.text()).includes('bb-auth'), p);
  }
  assert.match(await (await fetch(base + '/d/newsletter')).text(), /id="bb-auth"/);
});

test('no identity -> 401 JSON with login URL on every run endpoint', async () => {
  for (const [m, p] of RUNS) {
    const r = await fetch(base + p, { method: m });
    assert.equal(r.status, 401, `${m} ${p}`);
    const j = await r.json();
    assert.equal(j.error, 'login-required');
    assert.match(j.login_url, /\/gate\/start\?host=demos\.example\.org&return=/);
  }
});

test('spoofed X-Gate-Email / forged cookie / share-link subject / ungated host are all rejected', async () => {
  const bad = [{ 'x-gate-email': 'alice@example.org' }, { cookie: 'ct_gate_session=forged' }, { cookie: `ct_gate_session=${SHARE}` },
    { cookie: `ct_gate_session=${UNGATED}` }, { cookie: `ct_gate_session=forged`, 'x-gate-email': 'alice@example.org' }];
  for (const h of bad) assert.equal((await fetch(base + '/api/start', { method: 'POST', headers: h })).status, 401, JSON.stringify(h));
  assert.ok(gateCalls.every((c) => c.host === 'demos.example.org' && c.spoof === undefined), 'gate is asked with the configured host and no client headers');
});

test('valid identity is allowed through; per-account limit then answers 429', async () => {
  const h = { cookie: `ct_gate_session=${GOOD}` };
  for (let i = 0; i < 3; i++) {
    const r = await fetch(base + '/api/start', { method: 'POST', headers: h });
    assert.notEqual(r.status, 401); assert.notEqual(r.status, 429);
  }
  const r = await fetch(base + '/api/start', { method: 'POST', headers: h });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.equal((await fetch(base + '/auth/me', { headers: h }).then((x) => x.json())).authenticated, true);
});

test('unit: gate outage fails closed (503), window expiry frees the quota, logs carry no plain e-mail', async () => {
  let t = 0, down = false; const logs = [];
  const fetchImpl = async () => { if (down) throw new Error('boom'); return new Response(null, { status: 200, headers: { 'x-gate-email': 'Bob@Example.org' } }); };
  const a = createAuth({ env: { DEMO_AUTH_MODE: 'gate', DEMO_GATE_HOST: 'h.example.org', DEMO_RUNS_PER_HOUR: '1' }, fetchImpl, now: () => t, log: (o) => logs.push(o), posTtlMs: 0 });
  const mk = () => ({ req: { method: 'POST', headers: { cookie: 'ct_gate_session=tok' } }, url: new URL('http://x/api/plan') });
  const run = async () => { let status = 0; const res = { writeHead(s) { status = s; return this; }, end() {}, headersSent: false }; const { req, url } = mk(); const done = await a.guard(req, res, url); return done ? status : 200; };
  assert.equal(await run(), 200);
  assert.equal(await run(), 429);
  t += 3600_001; assert.equal(await run(), 200);
  down = true; t += 10; assert.equal(await run(), 503);
  const s = JSON.stringify(logs); assert.ok(!/bob|example\.org/i.test(s), s);
  assert.match(logs[0].account, /^[0-9a-f]{12}$/);
});

test('mode off (default) leaves everything open; gate mode without DEMO_GATE_HOST refuses to start', () => {
  assert.equal(createAuth({ env: {} }).mode, 'off');
  assert.throws(() => createAuth({ env: { DEMO_AUTH_MODE: 'gate' } }), /DEMO_GATE_HOST/);
  assert.throws(() => createAuth({ env: { DEMO_AUTH_MODE: 'typo' } }), /DEMO_AUTH_MODE/);
});
