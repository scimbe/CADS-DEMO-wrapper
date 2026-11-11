// Datei rueber (My Daily Idea): the TURN relay only for paying accounts. POST /api/duell/relay-grant signs a grant bound to
// one channel (lib/relay-grant.mjs) for an account with credit > 0, by gate cookie (browser) or Bearer (apps,
// lib/oidc-bearer.mjs). Secrets and keys here are generated per run for the tests only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { createCredit } from '../lib/duell-credit.mjs';
import { createRelay, readGrantSecret } from '../lib/duell-relay.mjs';
import { createBearer } from '../lib/oidc-bearer.mjs';
import { signRelayGrant, verifyRelayGrant, MAX_TTL_S } from '../lib/relay-grant.mjs';

const SECRET = randomBytes(32).toString('hex');
const CH = 'ab'.repeat(32);
const ISS = 'https://auth.example.test/realms/ct-demo';
const T0 = Date.UTC(2026, 10, 11, 9);

// ---------- grant format (same vector as CADS-webconference-demo test/play-relay-grant.test.mjs) ----------

test('Grant: Format und fester Testvektor wie in der Bridge', () => {
  const secret = 'test-only-vector-secret-0123456789abcdef';
  const g = signRelayGrant({ sub: 'a0123456789abcdef', ch: CH, now: 1_800_000_000_000, ttlS: 900 }, secret);
  assert.equal(g, 'rg1.eyJzdWIiOiJhMDEyMzQ1Njc4OWFiY2RlZiIsInB1cnBvc2UiOiJmaWxlIiwiY2giOiJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiIiwiaWF0IjoxODAwMDAwMDAwLCJleHAiOjE4MDAwMDA5MDB9.AQ5R0JlIOF1xOWshwutwkQ4KvzutAnmnOZP0sHB8qVw');
  assert.deepEqual(verifyRelayGrant(g, secret, { channel: CH, now: 1_800_000_100_000 }), { ok: true, sub: 'a0123456789abcdef', exp: 1_800_000_900 });
});

test('Grant: signiert nie ohne Geheimnis, nie laenger als 15 min, nie ohne Kanal', () => {
  assert.throws(() => signRelayGrant({ sub: 'a', ch: CH }, ''));
  assert.throws(() => signRelayGrant({ sub: 'a', ch: CH }, 'kurz'));
  assert.throws(() => signRelayGrant({ sub: 'a', ch: CH, ttlS: MAX_TTL_S + 1 }, SECRET));
  assert.throws(() => signRelayGrant({ sub: 'a', ch: 'xyz' }, SECRET));
  const g = signRelayGrant({ sub: 'a', ch: CH, now: T0, ttlS: 60 }, SECRET);
  assert.equal(verifyRelayGrant(g, SECRET, { channel: CH, now: T0 + 61_000 }).why, 'time');
  assert.equal(verifyRelayGrant(g, SECRET, { channel: 'cd'.repeat(32), now: T0 }).why, 'channel');
  assert.equal(verifyRelayGrant(g, randomBytes(32).toString('hex'), { channel: CH, now: T0 }).why, 'sig');
  assert.equal(verifyRelayGrant(g, SECRET, { channel: CH, now: T0, purpose: 'game' }).why, 'purpose');
});

test('Geheimnis: aus der Umgebung oder aus _FILE, der Wert wird nie geloggt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-secret-'));
  writeFileSync(join(dir, 's'), SECRET + '\n');
  assert.equal(readGrantSecret({ DUELL_RELAY_GRANT_SECRET_FILE: join(dir, 's') }), SECRET);
  assert.equal(readGrantSecret({ DUELL_RELAY_GRANT_SECRET: 'x' }), 'x');
  assert.equal(readGrantSecret({ DUELL_RELAY_GRANT_SECRET_FILE: join(dir, 'fehlt') }), '');
  const lines = [];
  createRelay({ env: { DUELL_RELAY_GRANT_SECRET: SECRET }, log: (o) => lines.push(JSON.stringify(o)) });
  createRelay({ env: { DUELL_RELAY_GRANT_SECRET: 'kurz' }, log: (o) => lines.push(JSON.stringify(o)) });
  assert.ok(lines.every((l) => !l.includes(SECRET) && !l.includes('kurz')));
});

// ---------- Bearer of the apps ----------

function issuer() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const state = { keys: [jwk], up: true, fetches: 0 };
  const fetchImpl = async (url) => {
    state.fetches++;
    assert.equal(url, ISS + '/protocol/openid-connect/certs');
    if (!state.up) throw new Error('down');
    return { ok: true, status: 200, json: async () => ({ keys: state.keys }) };
  };
  const token = (claims = {}, { kid = 'k1', key = privateKey, alg = 'RS256' } = {}) => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = Math.floor(T0 / 1000);
    const body = b({ alg, kid, typ: 'JWT' }) + '.' + b({ iss: ISS, azp: 'cads-mobile', typ: 'Bearer', exp: t + 300, iat: t, sub: 'u1', email: 'Lea@Example.org', email_verified: true, ...claims });
    return body + '.' + cryptoSign('RSA-SHA256', Buffer.from(body), key).toString('base64url');
  };
  return { state, fetchImpl, token, other: other.privateKey, addKey: (kid) => { const k = generateKeyPairSync('rsa', { modulusLength: 2048 }); state.keys.push({ ...k.publicKey.export({ format: 'jwk' }), kid }); return k.privateKey; } };
}

test('Bearer: gueltiges Token der App ergibt die E-Mail (klein), alles andere nicht', async () => {
  const is = issuer(), clock = { t: T0 };
  const b = createBearer({ env: { DUELL_BEARER_ISSUER: ISS }, fetchImpl: is.fetchImpl, now: () => clock.t });
  assert.deepEqual(await b.identify('Bearer ' + is.token()), { email: 'lea@example.org' });
  const bad = {
    'anderer Aussteller': is.token({ iss: 'https://evil.example/realms/ct-demo' }),
    'anderer Client': is.token({ azp: 'other-client' }),
    'abgelaufen': is.token({ exp: Math.floor(T0 / 1000) - 60 }),
    'noch nicht gueltig': is.token({ nbf: Math.floor(T0 / 1000) + 600 }),
    'E-Mail unbestaetigt': is.token({ email_verified: false }),
    'ohne E-Mail': is.token({ email: undefined }),
    'Refresh-Token': is.token({ typ: 'Refresh' }),
    'falscher Schluessel': is.token({}, { key: is.other }),
    'unbekannte kid': is.token({}, { kid: 'nope' }),
    'alg HS256': is.token({}, { alg: 'HS256' }),
  };
  for (const [why, t] of Object.entries(bad)) assert.deepEqual(await b.identify('Bearer ' + t), { email: null }, why);
  const [h, p] = is.token().split('.');
  assert.deepEqual(await b.identify(`Bearer ${h}.${p}.`), { email: null }, 'ohne Signatur');
  assert.deepEqual(await b.identify(`Bearer ${Buffer.from('{"alg":"none","kid":"k1"}').toString('base64url')}.${p}.x`), { email: null }, 'alg none');
  for (const h2 of [undefined, '', 'Basic abc', 'Bearer', 'Bearer a.b', 'bearer ' + is.token()]) assert.deepEqual(await b.identify(h2), { email: null }, String(h2).slice(0, 12));
});

test('Bearer: JWKS wird zwischengespeichert, bei neuer kid nachgeladen; nicht erreichbar -> Fehler, nie erlaubt', async () => {
  const is = issuer(), clock = { t: T0 };
  const b = createBearer({ env: { DUELL_BEARER_ISSUER: ISS }, fetchImpl: is.fetchImpl, now: () => clock.t });
  await b.identify('Bearer ' + is.token()); await b.identify('Bearer ' + is.token());
  assert.equal(is.state.fetches, 1);
  const k2 = is.addKey('k2');
  clock.t += 31_000;
  assert.deepEqual(await b.identify('Bearer ' + is.token({ exp: Math.floor(clock.t / 1000) + 300 }, { kid: 'k2', key: k2 })), { email: 'lea@example.org' });
  assert.equal(is.state.fetches, 2);
  const fresh = createBearer({ env: { DUELL_BEARER_ISSUER: ISS }, fetchImpl: async () => { throw new Error('down'); }, now: () => T0 });
  assert.deepEqual(await fresh.identify('Bearer ' + is.token()), { error: true });
  const off = createBearer({ env: { DUELL_BEARER_ISSUER: 'off' }, fetchImpl: is.fetchImpl, now: () => T0 });
  assert.deepEqual(await off.identify('Bearer ' + is.token()), { email: null });
});

// ---------- the route ----------

function setup({ env = { DUELL_RELAY_GRANT_SECRET: SECRET }, bearerEnv = { DUELL_BEARER_ISSUER: ISS } } = {}) {
  const clock = { t: T0 }, now = () => clock.t, lines = [];
  const log = (o) => lines.push(JSON.stringify(o));
  const dir = mkdtempSync(join(tmpdir(), 'duell-relay-'));
  const d = createDuell({ env: { DUELL_SEAL_SECRET: 'seal', DUELL_IP_HEADER: 'x-ip' }, salt: 's', log, llm: async () => '{}', now });
  const auth = { mode: 'gate', identify: async (req) => ({ email: (req && req.headers && req.headers['x-mail']) || null }) };
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: async () => '{}', shared: d.shared, auth, log, now });
  const credit = createCredit({ env: {}, now, log, file: join(dir, 'credit.json') });
  Object.assign(d.shared, { credit });
  const is = issuer();
  const bearer = createBearer({ env: bearerEnv, fetchImpl: is.fetchImpl, now });
  const relay = createRelay({ env, shared: d.shared, who: ai.who, acctOf: ai.acctOf, credit, bearer, now, log });
  return { clock, ai, credit, relay, lines, is };
}
async function serve(s) {
  const srv = http.createServer(async (q, r) => {
    const url = new URL(q.url, 'http://x');
    if (!(await s.relay.route(q, r, url)) && !(await s.ai.route(q, r, url))) r.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (body, headers = {}, path = '/api/duell/relay-grant') => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ip': '203.0.113.7', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { base, post, close: () => new Promise((r) => srv.close(r)) };
}
const pay = async (s, mail = 'lea@example.org', n = 2) => s.credit.grant((await s.ai.who({ headers: { 'x-mail': mail } }, {})).acct, n, 'voucher', 'deadbeef');

test('Route: mit Guthaben (Cookie) Abfrage und an den Kanal gebundener Grant; die Bridge-Pruefung nimmt ihn an', async () => {
  const s = setup(), h = await serve(s);
  try {
    await pay(s);
    const probe = await h.post({}, { 'x-mail': 'lea@example.org' });
    assert.deepEqual(probe, { status: 200, body: { ok: true, relay: true, credit: 2 } });
    const r = await h.post({ channel: CH.toUpperCase() }, { 'x-mail': 'lea@example.org' });
    assert.equal(r.status, 200);
    assert.equal(r.body.exp, Math.floor(T0 / 1000) + MAX_TTL_S);
    const v = verifyRelayGrant(r.body.grant, SECRET, { channel: CH, now: T0 + 1000 });
    assert.equal(v.ok, true);
    assert.equal(v.sub, (await s.ai.who({ headers: { 'x-mail': 'lea@example.org' } }, {})).acct, 'sub is the pseudonymous pot key, never the e-mail');
    assert.equal(s.credit.available(v.sub), 2, 'the relay spends nothing');
    // the log has the outcome only: no account, no channel, no grant
    assert.ok(s.lines.every((l) => !l.includes('lea@') && !l.includes(CH) && !l.includes(r.body.grant)));
  } finally { await h.close(); }
});

test('Route: ohne Guthaben 402, ohne Anmeldung 401, falscher Kanal 400, ohne Geheimnis 503', async () => {
  const s = setup(), h = await serve(s);
  try {
    assert.deepEqual(await h.post({ channel: CH }, { 'x-mail': 'frei@example.org' }), { status: 402, body: { ok: false, error: 'credit', credit: 0 } });
    assert.deepEqual(await h.post({}, { 'x-mail': 'frei@example.org' }), { status: 402, body: { ok: false, error: 'credit', credit: 0 } });
    assert.deepEqual(await h.post({ channel: CH }), { status: 401, body: { ok: false, error: 'login' } });
    assert.equal((await h.post({ channel: 'xyz' }, { 'x-mail': 'frei@example.org' })).status, 400);
    assert.equal((await h.post([1], { 'x-mail': 'frei@example.org' })).status, 400);
  } finally { await h.close(); }
  for (const env of [{}, { DUELL_RELAY_GRANT_SECRET: 'kurz' }]) {
    const s2 = setup({ env }), h2 = await serve(s2);
    try {
      await pay(s2);
      assert.deepEqual(await h2.post({ channel: CH }, { 'x-mail': 'lea@example.org' }), { status: 503, body: { ok: false, error: 'off' } });
    } finally { await h2.close(); }
  }
});

test('Route (App): Bearer desselben Kontos erreicht dasselbe Guthaben; ungueltiges Token -> 401; JWKS weg -> 503', async () => {
  const s = setup(), h = await serve(s);
  try {
    await pay(s, 'lea@example.org', 3);
    const r = await h.post({ channel: CH }, { authorization: 'Bearer ' + s.is.token() });
    assert.equal(r.status, 200);
    assert.equal(r.body.credit, 3);
    assert.equal(verifyRelayGrant(r.body.grant, SECRET, { channel: CH, now: T0 }).ok, true);
    assert.equal((await h.post({}, { authorization: 'Bearer ' + s.is.token({ email: 'frei@example.org' }) })).status, 402);
    assert.equal((await h.post({ channel: CH }, { authorization: 'Bearer ' + s.is.token({ azp: 'other' }) })).status, 401);
    assert.equal((await h.post({ channel: CH }, { authorization: 'Bearer ' + s.is.token({}, { key: s.is.other }) })).status, 401);
    assert.equal((await h.post({ channel: CH }, { authorization: 'Bearer ' + s.is.token({ exp: Math.floor(T0 / 1000) - 60 }) })).status, 401);
  } finally { await h.close(); }
  const s2 = setup(), h2 = await serve(s2);
  try {
    s2.is.state.up = false;
    assert.deepEqual(await h2.post({ channel: CH }, { authorization: 'Bearer ' + s2.is.token() }), { status: 503, body: { ok: false, error: 'auth-unavailable' } });
  } finally { await h2.close(); }
});

test('Route: hoechstens DUELL_RELAY_GRANTS_PER_HOUR Grants je Konto, die Abfrage zaehlt nicht', async () => {
  const s = setup({ env: { DUELL_RELAY_GRANT_SECRET: SECRET, DUELL_RELAY_GRANTS_PER_HOUR: '2' } }), h = await serve(s);
  try {
    await pay(s);
    const m = { 'x-mail': 'lea@example.org' };
    assert.equal((await h.post({}, m)).status, 200);
    assert.equal((await h.post({ channel: CH }, m)).status, 200);
    assert.equal((await h.post({ channel: CH }, m)).status, 200);
    assert.deepEqual(await h.post({ channel: CH }, m), { status: 429, body: { ok: false, error: 'limit' } });
    s.clock.t += 3600_000;
    assert.equal((await h.post({ channel: CH }, m)).status, 200);
  } finally { await h.close(); }
});

test('Route: nur POST mit JSON; /ai/status bleibt unveraendert', async () => {
  const s = setup(), h = await serve(s);
  try {
    await pay(s);
    assert.equal((await fetch(h.base + '/api/duell/relay-grant')).status, 405);
    assert.equal((await fetch(h.base + '/api/duell/relay-grant', { method: 'POST', headers: { 'x-mail': 'lea@example.org', 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await fetch(h.base + '/api/duell/relay-grant', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' })).status, 403);
    const st = await h.post({}, { 'x-mail': 'lea@example.org' }, '/api/duell/ai/status');
    assert.equal(st.status, 200);
    assert.equal(st.body.create.credit, 2);
  } finally { await h.close(); }
});
