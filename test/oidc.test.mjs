// App login (lib/oidc.mjs + lib/auth.mjs): an access token from Keycloak, checked against a FAKE JWKS with keys made
// here. No network: every fetch goes to an injected function. The point of the cookie-or-bearer design is tested at the
// end: both credentials resolve to the same account (same pot in lib/duell-ai.mjs, same run limit in the guard).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign, createPrivateKey } from 'node:crypto';
import { createBearer, authHeader, createSubjectBinding } from '../lib/oidc.mjs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth } from '../lib/auth.mjs';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';

const ISS = 'https://auth.example.org/realms/ct-demo';
const ENV = { DEMO_OIDC_ISSUER: ISS, DEMO_OIDC_AUDIENCE: 'mydailyidea-api', DEMO_OIDC_CLIENT_IDS: 'cads-mobile' };
const SALT = 'test-salt-0123456789';
const bindFile = () => join(mkdtempSync(join(tmpdir(), 'oidc-bind-')), 'subjects.json');
const freshBinding = () => createSubjectBinding({ file: bindFile(), salt: SALT });
const ENVB = () => ({ ...ENV, DEMO_OIDC_BINDING_FILE: bindFile(), DEMO_OIDC_BINDING_SALT: SALT });
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rsa2 = generateKeyPairSync('rsa', { modulusLength: 2048 });
const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
const jwk = (kp, kid, alg, extra = {}) => ({ ...kp.publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig', ...extra });
const JWKS = { keys: [jwk(rsa, 'r1', 'RS256'), jwk(ec, 'e1', 'ES256'), jwk(weak, 'w1', 'RS256'), { ...jwk(rsa2, 'enc1', 'RSA-OAEP'), use: 'enc' }] };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const T0 = 1_800_000_000_000;

function token(claims = {}, header = {}, key = rsa.privateKey) {
  const h = { alg: 'RS256', typ: 'JWT', kid: 'r1', ...header };
  const sec = Math.floor(T0 / 1000);
  const c = { iss: ISS, aud: ['mydailyidea-api', 'account'], azp: 'cads-mobile', typ: 'Bearer', exp: sec + 300, iat: sec, sub: 'u1',
    email: 'Lea@Example.org', email_verified: true, ...claims };
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  const input = b64(h) + '.' + b64(c);
  const alg = h.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key;
  const sig = h.alg === 'none' ? Buffer.alloc(0) : cryptoSign('sha256', Buffer.from(input), alg);
  return input + '.' + sig.toString('base64url');
}

function fakeJwks(initial = JWKS) {
  const f = { calls: 0, body: initial, down: false };
  f.fetch = async (url, init) => {
    f.calls++;
    assert.equal(url, ISS + '/protocol/openid-connect/certs');
    assert.equal(init.redirect, 'error');
    if (f.down) throw new Error('offline');
    return new Response(JSON.stringify(f.body), { status: 200 });
  };
  return f;
}
const mk = (o = {}) => { const j = o.jwks || fakeJwks(); let t = o.t ?? T0; const logs = [];
  const b = createBearer({ env: { ...ENV, ...(o.env || {}) }, fetchImpl: j.fetch, now: () => t, log: (x) => logs.push(x), binding: o.binding || freshBinding() });
  return { b, j, logs, at: (x) => { t = x; } };
};

test('config: off without env, all three together or refuse to start, https only', () => {
  assert.equal(createBearer({ env: {} }).enabled, false);
  for (const k of Object.keys(ENV)) {
    const env = { ...ENV }; delete env[k];
    assert.throws(() => createBearer({ env }), /together/, k);
  }
  assert.throws(() => createBearer({ env: { ...ENV, DEMO_OIDC_ISSUER: 'http://auth.example.org/realms/x' } }), /https/);
  assert.throws(() => createBearer({ env: { ...ENV, DEMO_OIDC_JWKS_URL: 'http://auth.example.org/certs' } }), /https/);
  assert.throws(() => createBearer({ env: ENV }), /DEMO_OIDC_BINDING_FILE/, 'no subject binding: refuses to start');
  assert.throws(() => createBearer({ env: { ...ENVB(), DEMO_OIDC_BINDING_SALT: 'short' } }), /at least 16/);
  assert.equal(createBearer({ env: ENVB(), fetchImpl: async () => { throw new Error('no network in tests'); } }).enabled, true);
});

test('valid RS256 and ES256 access tokens yield the e-mail; only signing keys of allowed kinds are loaded', async () => {
  const { b } = mk();
  assert.deepEqual(await b.verify(token()), { email: 'Lea@Example.org' });
  assert.deepEqual(await b.verify(token({}, { alg: 'ES256', kid: 'e1' }, ec.privateKey)), { email: 'Lea@Example.org' });
  assert.deepEqual([...b._keys().keys()].sort(), ['e1', 'r1'], 'enc key and 1024-bit RSA key are ignored');
  assert.equal((await b.verify(token({}, { kid: 'w1' }, weak.privateKey))).reason, 'kid');
  assert.deepEqual(await b.verify(token({ aud: 'mydailyidea-api' })), { email: 'Lea@Example.org' }, 'aud as a string');
  assert.deepEqual(await b.verify(token({}, { typ: 'at+jwt' })), { email: 'Lea@Example.org' });
});

test('signature, algorithm and header attacks are refused', async () => {
  const { b } = mk();
  const good = token(), [h, c] = good.split('.');
  const forged = h + '.' + b64({ ...JSON.parse(Buffer.from(c, 'base64url')), email: 'mallory@example.org' }) + '.' + good.split('.')[2];
  assert.equal((await b.verify(forged)).reason, 'signature');
  assert.equal((await b.verify(token({}, {}, rsa2.privateKey))).reason, 'signature', 'right kid, other key');
  assert.equal((await b.verify(token({}, { alg: 'none' }))).reason, 'format', 'alg none, empty signature');
  assert.equal((await b.verify(token({}, { alg: 'none' }) + 'AAAA')).reason, 'alg', 'alg none with any signature');
  assert.equal((await b.verify(token({}, { alg: 'HS256' }))).reason, 'alg');
  assert.equal((await b.verify(token({}, { alg: 'PS256' }))).reason, 'alg');
  assert.equal((await b.verify(token({}, { alg: 'ES256', kid: 'r1' }, ec.privateKey))).reason, 'alg', 'alg must match the key (no confusion)');
  assert.equal((await b.verify(token({}, { alg: 'RS256', kid: 'e1' }))).reason, 'alg');
  const pem = createPrivateKey(rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.equal((await b.verify(token({}, { jwk: jwk(rsa, 'x', 'RS256') }, pem))).reason, 'header', 'embedded key never trusted');
  assert.equal((await b.verify(token({}, { jku: 'https://evil.example/jwks' }))).reason, 'header');
  assert.equal((await b.verify(token({}, { crit: ['exp'] }))).reason, 'header');
  assert.equal((await b.verify(token({}, { typ: 'dpop+jwt' }))).reason, 'typ');
  assert.equal((await b.verify(token({}, { kid: undefined }))).reason, 'kid');
  for (const bad of ['', 'a.b', 'a.b.c.d', 'a.b.c d', 'x'.repeat(9000), '..', 'é.é.é']) assert.equal((await b.verify(bad)).reason, 'format', JSON.stringify(bad.slice(0, 10)));
});

test('claims: iss, aud, azp, typ, binding, time with skew, verified e-mail', async () => {
  const { b, at } = mk();
  const sec = Math.floor(T0 / 1000);
  const cases = [
    [{ iss: ISS + '/' }, 'iss'], [{ iss: 'https://evil.example/realms/ct-demo' }, 'iss'],
    [{ aud: 'account' }, 'aud'], [{ aud: undefined }, 'aud'], [{ aud: ['cads-mobile'] }, 'aud'],
    [{ azp: 'ct-portal' }, 'azp'], [{ azp: undefined }, 'azp'],
    [{ typ: 'ID' }, 'typ'], [{ typ: 'Refresh' }, 'typ'], [{ typ: 'DPoP' }, 'typ'], [{ typ: undefined }, 'typ'],
    [{ sub: undefined }, 'sub'], [{ sub: '' }, 'sub'], [{ sub: 7 }, 'sub'],
    [{ iat: undefined }, 'iat'], [{ exp: sec + 901 }, 'lifetime'], [{ iat: sec - 1000, exp: sec + 10 }, 'lifetime'],
    [{ cnf: { jkt: 'abc' } }, 'bound'],
    [{ exp: undefined }, 'exp'], [{ exp: sec - 6, iat: sec - 300 }, 'exp'], [{ exp: String(sec + 300) }, 'exp'],
    [{ nbf: sec + 6 }, 'nbf'], [{ iat: sec + 6, exp: sec + 306 }, 'iat'],
    [{ email: undefined }, 'email'], [{ email: 'share:abc' }, 'email'], [{ email: 'no-at-sign' }, 'email'], [{ email: 'a@' + 'b'.repeat(260) }, 'email'],
    [{ email_verified: false }, 'email-unverified'], [{ email_verified: 'true' }, 'email-unverified'], [{ email_verified: undefined }, 'email-unverified'],
  ];
  for (const [claims, reason] of cases) assert.equal((await b.verify(token(claims))).reason, reason, JSON.stringify(claims));
  assert.equal((await b.verify(token({ exp: sec - 4, iat: sec - 300 }))).email, 'Lea@Example.org', 'expiry within the 5 s skew');
  assert.equal((await b.verify(token({ nbf: sec + 4 }))).email, 'Lea@Example.org');
  assert.equal((await b.verify(token({ exp: sec + 900 }))).email, 'Lea@Example.org', '15 min is the longest lifetime');
  const later = token(); at(T0 + 301_000 + 5_000);
  assert.equal((await b.verify(later)).reason, 'exp', 'a cached token still expires');
});

test('JWKS: cached, refetched on a new kid at most every 30 s (rotation), fail closed when never reachable', async () => {
  const j = fakeJwks({ keys: [jwk(rsa, 'r1', 'RS256')] });
  const { b, at } = mk({ jwks: j });
  assert.equal((await b.verify(token())).email, 'Lea@Example.org');
  assert.equal((await b.verify(token({ jti: 'second' }))).email, 'Lea@Example.org');
  assert.equal(j.calls, 1, 'one fetch for many tokens');
  // rotation: Keycloak adds a new key; the first token with the new kid within 30 s of the last fetch is refused,
  // after that one refetch finds it. Random kids never cause more than one fetch per 30 s.
  j.body = { keys: [jwk(rsa, 'r1', 'RS256'), jwk(rsa2, 'r2', 'RS256')] };
  assert.equal((await b.verify(token({}, { kid: 'r2' }, rsa2.privateKey))).reason, 'kid');
  for (let i = 0; i < 20; i++) await b.verify(token({}, { kid: 'random' + i }));
  assert.equal(j.calls, 1);
  at(T0 + 30_000);
  assert.equal((await b.verify(token({}, { kid: 'r2' }, rsa2.privateKey))).email, 'Lea@Example.org');
  assert.equal(j.calls, 2);
  // Keycloak down: the cached keys keep working (stale, under 2 h), new kids are refused, nothing is "allowed" blindly
  const at2 = (ms) => { at(T0 + ms); const s0 = Math.floor((T0 + ms) / 1000); return { iat: s0, exp: s0 + 300 }; };
  j.down = true;
  assert.equal((await b.verify(token({ jti: 'u3', ...at2(700_000) }))).email, 'Lea@Example.org');
  assert.deepEqual(await b.verify(token({ jti: 'u4', ...at2(2 * 3600_000 + 60_000) })), { error: true }, 'keys older than 2 h are dropped');

  const down = fakeJwks(); down.down = true;
  const m2 = mk({ jwks: down });
  assert.deepEqual(await m2.b.verify(token()), { error: true });
  assert.deepEqual(await m2.b.verify(token()), { error: true });
  assert.equal(down.calls, 1, 'retries at most every 5 s while unreachable');
  down.down = false; m2.at(T0 + 5000);
  assert.equal((await m2.b.verify(token())).email, 'Lea@Example.org');
  for (const body of [{ keys: [] }, { nope: 1 }, { keys: [{ ...jwk(rsa, 'k', 'RS256'), use: 'enc' }] }]) {
    const bad = fakeJwks(body);
    assert.deepEqual(await mk({ jwks: bad }).b.verify(token()), { error: true }, JSON.stringify(body).slice(0, 40));
  }
});

test('refusals are logged by reason only (no token, no e-mail), at most once a minute per reason', async () => {
  const { b, logs } = mk();
  for (let i = 0; i < 5; i++) await b.verify(token({ email_verified: false }));
  await b.verify(token({ azp: 'other' }));
  assert.deepEqual(logs.map((l) => l.reason), ['email-unverified', 'azp']);
  assert.ok(!/Lea|example\.org|eyJ/.test(JSON.stringify(logs)), JSON.stringify(logs));
});

test('authHeader: scheme and token, nothing else', () => {
  assert.equal(authHeader({ headers: {} }), null);
  assert.deepEqual(authHeader({ headers: { authorization: 'Bearer abc.def.ghi' } }), { scheme: 'bearer', token: 'abc.def.ghi' });
  assert.deepEqual(authHeader({ headers: { authorization: 'bearer   abc' } }), { scheme: 'bearer', token: 'abc' });
  assert.deepEqual(authHeader({ headers: { authorization: 'DPoP abc' } }), { scheme: 'dpop', token: 'abc' });
  assert.equal(authHeader({ headers: { authorization: 'Bearer a b' } }).scheme, 'invalid');
  assert.equal(authHeader({ headers: { authorization: 'Basic' } }).scheme, 'invalid');
});

// ---- one identity: lib/auth.mjs ----
const GATE = { DEMO_AUTH_MODE: 'gate', DEMO_GATE_HOST: 'demos.example.org', DEMO_RUNS_PER_HOUR: '2' };
function mkAuth(o = {}) {
  const gateCalls = [];
  const j = o.jwks || fakeJwks();
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/protocol/openid-connect/certs')) return j.fetch(url, init);
    gateCalls.push(init.headers.cookie);
    // the gate answers the cookie "ct_gate_session=<anything>" with Lea; X-Gate-Sub as the gate sends it (o.gateSub; null: not at all)
    const sub = o.gateSub === undefined ? 'u1' : o.gateSub;
    const mail = /mail=([^;]+)/.exec(init.headers.cookie);
    return new Response(null, { status: 200, headers: { 'x-gate-email': mail ? mail[1] : 'lea@example.org', ...(sub ? { 'x-gate-sub': sub } : {}) } });
  };
  const env = { ...GATE, ...(o.oidc === false ? {} : ENV) };
  const logs = [];
  const binding = o.binding || freshBinding();
  const a = createAuth({ env, fetchImpl, now: () => T0, log: (x) => logs.push(x), bearer: o.oidc === false ? undefined : createBearer({ env, fetchImpl: j.fetch, now: () => T0, log: () => {}, binding }) });
  return { a, gateCalls, j, logs, binding };
}
const req = (headers) => ({ method: 'POST', headers });

test('identify: cookie and bearer give the same account; the header decides alone when present', async () => {
  const { a, gateCalls } = mkAuth();
  assert.deepEqual(await a.identify(req({ cookie: 'ct_gate_session=tok' })), { email: 'lea@example.org', via: 'cookie' });
  assert.deepEqual(await a.identify(req({ authorization: 'Bearer ' + token() })), { email: 'Lea@Example.org', via: 'bearer' });
  assert.equal(gateCalls.length, 1, 'bearer never asks the gate');
  // invalid token + valid cookie: not logged in (no silent fallback), and the gate is not asked
  assert.deepEqual(await a.identify(req({ authorization: 'Bearer ' + token({ email_verified: false }), cookie: 'ct_gate_session=tok2' })), { email: null });
  assert.deepEqual(await a.identify(req({ authorization: 'DPoP ' + token(), cookie: 'ct_gate_session=tok2' })), { email: null });
  assert.deepEqual(await a.identify(req({ authorization: 'Basic dXNlcjpwYXNz' })), { email: null });
  assert.equal(gateCalls.length, 1);
  assert.equal(a.hasCredential(req({ authorization: 'Bearer x' })), true);
  assert.equal(a.hasCredential(req({})), false);
  assert.equal(a.appLogin, true);
});

test('identify without DEMO_OIDC_*: the Authorization header is ignored, the cookie path is unchanged', async () => {
  const { a, gateCalls } = mkAuth({ oidc: false });
  assert.equal(a.appLogin, false);
  assert.deepEqual(await a.identify(req({ authorization: 'Bearer ' + token() })), { email: null });
  assert.deepEqual(await a.identify(req({ authorization: 'Bearer ' + token(), cookie: 'ct_gate_session=t' })), { email: 'lea@example.org', via: 'cookie' });
  assert.equal(a.hasCredential(req({ authorization: 'Bearer x' })), false);
  assert.equal(gateCalls.length, 1);
  assert.throws(() => createAuth({ env: ENVB() }), /DEMO_AUTH_MODE=gate/, 'app login needs gate mode');
});

test('guard: bearer passes the login check, shares the run limit with the cookie, 503 when the keys are unreachable', async () => {
  const run = async (a, headers) => {
    let status = 0; const res = { writeHead(s) { status = s; return this; }, end() {}, headersSent: false };
    return (await a.guard(req(headers), res, new URL('http://x/api/plan'))) ? status : 200;
  };
  const { a } = mkAuth();
  assert.equal(await run(a, { authorization: 'Bearer ' + token({ email: 'lea@example.org' }) }), 200);
  assert.equal(await run(a, { cookie: 'ct_gate_session=tok' }), 200);
  assert.equal(await run(a, { authorization: 'Bearer ' + token({ email: 'LEA@example.org', jti: 'x' }) }), 429, 'same account, same limit (case-insensitive)');
  assert.equal(await run(a, { authorization: 'Bearer ' + token({ azp: 'ct-portal' }) }), 401);
  const down = fakeJwks(); down.down = true;
  assert.equal(await run(mkAuth({ jwks: down }).a, { authorization: 'Bearer ' + token() }), 503);
  // /auth/me answers for the app too
  let body = ''; const res = { writeHead() { return this; }, end(b) { body = b; }, headersSent: false };
  await a.guard({ method: 'GET', headers: { authorization: 'Bearer ' + token() } }, res, new URL('http://x/auth/me'));
  assert.deepEqual([JSON.parse(body).authenticated, JSON.parse(body).app_login], [true, true]);
});

test('My Daily Idea: the app token and the web cookie reach the same pot (lib/duell-ai.mjs who)', async () => {
  const { a } = mkAuth();
  const d = createDuell({ env: { DUELL_DAILY_MAX: '50', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: async () => '{}' });
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: async () => '{}', shared: d.shared, auth: a, log: () => {} });
  const web = await ai.who(req({ cookie: 'ct_gate_session=tok' }), { device: 'a'.repeat(32) });
  const app = await ai.who(req({ authorization: 'Bearer ' + token() }), { device: 'b'.repeat(32) });
  assert.equal(web.account, true); assert.equal(app.account, true);
  assert.equal(web.key, app.key, 'one account, one key');
  const anon = await ai.who(req({ authorization: 'Bearer ' + token({ email_verified: false }) }), { device: 'b'.repeat(32) });
  assert.equal(anon.account, false);
});

test('subject binding: first (iss, sub) per address wins; another subject with the same address is refused; survives a restart', async () => {
  const file = bindFile();
  const { b } = mk({ binding: createSubjectBinding({ file, salt: SALT }) });
  assert.equal((await b.verify(token())).email, 'Lea@Example.org');
  assert.equal((await b.verify(token({ jti: 'again' }))).email, 'Lea@Example.org', 'same subject again');
  assert.equal((await b.verify(token({ sub: 'u-other' }))).reason, 'subject-changed', 're-assigned address at an IdP cannot take over');
  assert.equal((await b.verify(token({ sub: 'u-other', email: 'LEA@example.org' }))).reason, 'subject-changed', 'case does not help');
  assert.equal((await b.verify(token({ sub: 'u2', email: 'tom@example.org' }))).email, 'tom@example.org', 'other address: own binding');
  const raw = readFileSync(file, 'utf8');
  assert.ok(!/lea|tom|example|u-other|u1/i.test(raw), 'no address or subject in clear: ' + raw);
  // after a restart the binding is still there
  const { b: b2 } = mk({ binding: createSubjectBinding({ file, salt: SALT }) });
  assert.equal((await b2.verify(token({ sub: 'u-other', jti: 'r' }))).reason, 'subject-changed');
  assert.equal((await b2.verify(token({ jti: 'r2' }))).email, 'Lea@Example.org');
  // a broken file stops the start instead of forgetting every binding
  writeFileSync(file, '{"v":2}');
  assert.throws(() => createSubjectBinding({ file, salt: SALT }), /not a binding file/);
  // an unwritable file: the new binding is not accepted (fail closed)
  const ro = createSubjectBinding({ file: join(bindFile(), 'missing-dir', 'x.json'), salt: SALT });
  const { b: b3 } = mk({ binding: ro });
  assert.equal((await b3.verify(token())).reason, 'subject-changed');
});

test('JWKS: concurrent first requests wait for the one running fetch; the body is capped while streaming', async () => {
  let release, calls = 0;
  const gate = new Promise((r) => { release = r; });
  const slow = async () => { calls++; await gate; return new Response(JSON.stringify(JWKS), { status: 200 }); };
  const b = createBearer({ env: ENV, fetchImpl: slow, now: () => T0, log: () => {}, binding: freshBinding() });
  const both = Promise.all([b.verify(token()), b.verify(token({ jti: 'p2' }))]);
  release();
  assert.deepEqual((await both).map((r) => r.email), ['Lea@Example.org', 'Lea@Example.org'], 'no 503 for the second request');
  assert.equal(calls, 1);
  let pulled = 0;
  const huge = async () => new Response(new ReadableStream({ pull(c) { pulled++; if (pulled > 1000) { c.close(); return; } c.enqueue(new Uint8Array(16384)); } }), { status: 200 });
  const b2 = createBearer({ env: ENV, fetchImpl: huge, now: () => T0, log: () => {}, binding: freshBinding() });
  assert.deepEqual(await b2.verify(token()), { error: true });
  assert.ok(pulled < 10, 'stopped reading after the cap, pulled ' + pulled);
  const declared = async () => new Response('{}', { status: 200, headers: { 'content-length': '999999' } });
  assert.deepEqual(await createBearer({ env: ENV, fetchImpl: declared, now: () => T0, log: () => {}, binding: freshBinding() }).verify(token()), { error: true });
});

// ---- security review M3: the gate cookie takes part in the subject binding ----
test('M3: with X-Gate-Sub the cookie binds at first sight; an app token with another subject is refused, and the other way round', async () => {
  const { a } = mkAuth();
  assert.deepEqual(await a.identify(req({ cookie: 'ct_gate_session=web1' })), { email: 'lea@example.org', via: 'cookie' }, 'first sight on the web binds (u1)');
  assert.deepEqual(await a.identify(req({ authorization: 'Bearer ' + token({ sub: 'u-attacker', jti: 'a1' }) })), { email: null }, 'an app token with another subject');
  assert.deepEqual(await a.identify(req({ authorization: 'Bearer ' + token({ jti: 'a2' }) })), { email: 'Lea@Example.org', via: 'bearer' }, 'the same subject');
  // the app came first: the web login with another subject is refused (logged, without the address)
  const b = mkAuth({ gateSub: 'u-other' });
  assert.equal((await b.a.identify(req({ authorization: 'Bearer ' + token({ jti: 'b1' }) }))).email, 'Lea@Example.org');
  assert.deepEqual(await b.a.identify(req({ cookie: 'ct_gate_session=web2' })), { email: null });
  assert.deepEqual(b.logs.map((x) => [x.event, x.reason]), [['auth-cookie-refused', 'subject-changed']]);
  assert.ok(!JSON.stringify(b.logs).includes('lea@'), 'no address in the log');
});

test('M3: without X-Gate-Sub an address known from the web is never bound first by an app token ("link-pending"); a new address is', async () => {
  const { a, binding } = mkAuth({ gateSub: null });
  assert.deepEqual(await a.identify(req({ cookie: 'ct_gate_session=web1' })), { email: 'lea@example.org', via: 'cookie' }, 'the web login itself works as before');
  assert.equal(binding.webOnly(), 1);
  assert.deepEqual(await a.identify(req({ authorization: 'Bearer ' + token({ jti: 'p1' }) })), { email: null }, 'first come does not bind a web account');
  const b = mk({ binding });
  assert.equal((await b.b.verify(token({ jti: 'p2' }))).reason, 'link-pending');
  assert.equal((await b.b.verify(token({ sub: 'u9', email: 'neu@example.org', jti: 'p3' }))).email, 'neu@example.org', 'an address never seen on the web binds with its first token');
  // once the gate sends the subject, the web login binds and the app with the same subject works
  const c = mkAuth({ binding });
  assert.equal((await c.a.identify(req({ cookie: 'ct_gate_session=web3' }))).email, 'lea@example.org');
  assert.equal((await c.a.identify(req({ authorization: 'Bearer ' + token({ jti: 'p4' }) }))).email, 'Lea@Example.org');
  assert.equal(binding.webOnly(), 0);
});

test('M3: the binding file keeps the web marks across a restart, loads files from before M3, and an unwritable file refuses (fail closed)', async () => {
  const file = bindFile();
  const one = createSubjectBinding({ file, salt: SALT });
  assert.equal(one.seenWeb('lea@example.org'), true);
  assert.equal(createSubjectBinding({ file, salt: SALT }).bind('lea@example.org', ISS, 'u1', 'bearer'), 'pending', 'after a restart');
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes('lea') && !raw.includes('example'), 'only HMACs');
  // a file written before M3 ({ v: 1, b } without c)
  const old = bindFile(); writeFileSync(old, JSON.stringify({ v: 1, b: {} }));
  assert.equal(createSubjectBinding({ file: old, salt: SALT }).bind('tom@example.org', ISS, 'u2', 'bearer'), 'ok');
  writeFileSync(old, JSON.stringify({ v: 1, b: {}, c: [] }));
  assert.throws(() => createSubjectBinding({ file: old, salt: SALT }), /not a binding file/);
  // unwritable: neither a binding nor a web mark is taken as given
  const dirRo = mkdtempSync(join(tmpdir(), 'oidc-ro-')), ro = createSubjectBinding({ file: join(dirRo, 'sub', 'x.json'), salt: SALT, log: () => {} });
  assert.equal(ro.bind('lea@example.org', ISS, 'u1', 'cookie'), 'unwritable');
  assert.equal(ro.seenWeb('lea@example.org'), false);
  const { a } = mkAuth({ binding: ro, gateSub: null });
  assert.deepEqual(await a.identify(req({ cookie: 'ct_gate_session=web9' })), { email: null }, 'web login refused when it cannot be marked');
});

