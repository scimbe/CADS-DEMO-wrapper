// The gallery side of saved installations, against a stand-in that answers like the control plane.
// The control plane itself is covered by its own tests (CADS-Tunnel, installations.rs).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { createInstallations, recordFor, publicRecord, isInstallationId } from '../lib/installations.mjs';

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const TOKEN = 'test-delegate-token';
const ID = '11111111-2222-4333-8444-555555555555';
let cp, gate, proc, base, seen = [], cpAnswer;

before(async () => {
  cp = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body: b }); const [s, o] = cpAnswer(req, b); res.writeHead(s, typeof o === 'string' ? {} : { 'content-type': 'application/json' }).end(typeof o === 'string' ? o : JSON.stringify(o)); });
  });
  gate = http.createServer((req, res) => {
    const ok = /ct_gate_session=alice/.test(req.headers.cookie || '');
    res.writeHead(ok ? 200 : 302, ok ? { 'x-gate-email': 'alice@example.com' } : { location: '/gate/start' }).end();
  });
  await Promise.all([new Promise((r) => cp.listen(0, '127.0.0.1', r)), new Promise((r) => gate.listen(0, '127.0.0.1', r))]);
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', DEMO_AUTH_MODE: 'gate', DEMO_GATE_HOST: 'gallery.example', DEMO_GATE_CHECK_URL: `http://127.0.0.1:${gate.address().port}/gate/check`, INSTALLATIONS_API_URL: `http://127.0.0.1:${cp.address().port}`, INSTALLATIONS_DELEGATE_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => { const to = setTimeout(() => reject(new Error('no start')), 8000); proc.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) { clearTimeout(to); resolve(); } }); });
});
after(() => { proc?.kill(); cp?.close(); gate?.close(); });

const as = (cookie) => ({ cookie: `ct_gate_session=${cookie}`, 'content-type': 'application/json' });
const values = { location: 'Hamburg' };

test('anonymous visitors get a login answer and never reach the control plane', async () => {
  seen = [];
  for (const r of [await fetch(`${base}/api/installations`), await fetch(`${base}/api/installations`, { method: 'POST', body: '{}' })]) {
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, 'login-required');
  }
  assert.equal(seen.length, 0);
});

test('save: only derived fields go out, with the delegate token and the visitor session', async () => {
  seen = [];
  cpAnswer = (_r, b) => [201, { ...JSON.parse(b), id: ID, updated_at: 1, revision: 1 }];
  const page = await (await fetch(`${base}/api/template/newsletter`)).json();
  const defaults = Object.fromEntries(Object.entries(page.meta.params).filter(([, v]) => 'default' in v).map(([k, v]) => [k, v.default]));
  const r = await fetch(`${base}/api/installations`, { method: 'POST', headers: as('alice'), body: JSON.stringify({ demo: 'newsletter', name: 'Mein Newsletter', values: defaults, template_digest: 'f'.repeat(64), status: 'removed' }) });
  assert.equal(r.status, 201, await r.clone().text());
  assert.equal((await r.json()).slug, 'newsletter');
  const sent = seen.find((x) => x.method === 'POST');
  assert.equal(sent.headers['x-ct-installations-delegate'], TOKEN);
  assert.equal(sent.headers['x-ct-gate-session'], 'alice');
  const rec = JSON.parse(sent.body);
  assert.match(rec.template_digest, /^[0-9a-f]{64}$/);
  assert.notEqual(rec.template_digest, 'f'.repeat(64));
  assert.equal(rec.status, 'installed');
  assert.ok(rec.components.length >= 1 && rec.manifest_ids.length >= 1);
});

test('save: invalid values never reach the control plane', async () => {
  seen = [];
  const r = await fetch(`${base}/api/installations`, { method: 'POST', headers: as('alice'), body: JSON.stringify({ demo: 'newsletter', values: { nope: 1 } }) });
  assert.ok(r.status >= 400 && r.status < 500);
  assert.equal(seen.length, 0);
});

test('a 422 for credential-looking values reaches the visitor as plain words, without control-plane text', async () => {
  cpAnswer = () => [422, 'values.topic looks like a credential'];
  const page = await (await fetch(`${base}/api/template/newsletter`)).json();
  const defaults = Object.fromEntries(Object.entries(page.meta.params).filter(([, v]) => 'default' in v).map(([k, v]) => [k, v.default]));
  const r = await fetch(`${base}/api/installations`, { method: 'POST', headers: as('alice'), body: JSON.stringify({ demo: 'newsletter', values: defaults }) });
  assert.equal(r.status, 422);
  assert.match((await r.json()).message, /Passwort oder Schlüssel/);
});

test('list, reopen, delete; a session the control plane refuses asks for a new login', async () => {
  cpAnswer = (req) => (req.method === 'DELETE' ? [204, ''] : req.url.includes(ID) ? [200, { id: ID, name: 'x', template_id: '0'.repeat(64), values, updated_at: 1 }] : [200, { items: [{ id: ID, name: 'x', template_id: '0'.repeat(64), values, updated_at: 1 }], total: 1 }]);
  const list = await (await fetch(`${base}/api/installations`, { headers: as('alice') })).json();
  assert.deepEqual(list.items[0], { id: ID, name: 'x', slug: null, values, updated_at: 1 });
  assert.equal((await fetch(`${base}/api/installations/${ID}`, { headers: as('alice') })).status, 200);
  assert.equal((await fetch(`${base}/api/installations/${ID}`, { method: 'DELETE', headers: as('alice') })).status, 204);
  cpAnswer = () => [401, 'delegate refused'];
  const r = await fetch(`${base}/api/installations`, { headers: as('alice') });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'relogin');
});

test('an id that is not a uuid never reaches the control plane', async () => {
  seen = [];
  assert.equal((await fetch(`${base}/api/installations/..%2f..%2fadmin`, { headers: as('alice') })).status, 404);
  assert.equal(seen.length, 0);
});

test('saving does not use up the runs per hour', async () => {
  cpAnswer = () => [200, { items: [], total: 0 }];
  for (let i = 0; i < 25; i++) assert.equal((await fetch(`${base}/api/installations`, { headers: as('alice') })).status, 200);
});

test('without a delegate token the feature is off', () => {
  assert.equal(createInstallations({ env: { DEMO_AUTH_MODE: 'gate' } }).enabled, false);
  assert.equal(createInstallations({ env: { INSTALLATIONS_DELEGATE_TOKEN: 'x' } }).enabled, false);
  assert.equal(createInstallations({ env: { DEMO_AUTH_MODE: 'gate', INSTALLATIONS_DELEGATE_TOKEN: 'x' } }).enabled, true);
});

test('record helpers', () => {
  assert.equal(isInstallationId(ID), true);
  assert.equal(isInstallationId('../x'), false);
  const rec = recordFor({ template: { name: 'T', components: [{ name: 'c', sha256: 'a', manifest_id: 'm' }, { name: 'd', sha256: 'b' }] }, rendered: { template_id: 'i', template_digest: 'd', values_digest: 'v' }, values, name: '  ', lang: 'de' });
  assert.equal(rec.name, 'T');
  assert.deepEqual(rec.manifest_ids, ['m']);
  assert.deepEqual(rec.components[1], { name: 'd', sha256: 'b' });
  assert.equal(publicRecord({ id: 1, name: 'n', template_id: 't', values, updated_at: 2, target: { os: 'x' } }, () => 's').target, undefined);
});
