// Short links: storage survives a restart, limits, delete token, expiry, pages, preview, CORS, no IP on disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShortLinks, ID_RE, ALPHABET, newId, OPEN_SCRIPT, MAX_FRAGMENT } from '../lib/shortlink.mjs';
import { createDuell } from '../lib/duell.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = () => mkdtempSync(join(tmpdir(), 'short-'));
const F = 'c=eyJ2IjoxLCJkIjp7Im4iOiJNaXJhIn19';
const DAY = 86400000;
const mk = (env = {}, over = {}) => createShortLinks({ env: { SHORT_DATA_DIR: dir(), ...env }, log: () => {}, root, ...over });

function serve(s) {
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => s.route(req, res, new URL(req.url, 'http://x')).then((mine) => { if (!mine) res.writeHead(599).end(); }));
    srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.close(); srv.closeAllConnections(); } }));
  });
}
const post = (base, body, headers = {}) => fetch(base + '/api/s', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('id: eight characters from the readable alphabet, enough entropy, no counter', () => {
  assert.equal(ALPHABET.length, 56);
  assert.ok(!/[0O1lI]/.test(ALPHABET));
  assert.ok(Math.log2(56) * 8 > 46);
  const ids = Array.from({ length: 5000 }, newId);
  assert.ok(ids.every((x) => ID_RE.test(x)));
  assert.equal(new Set(ids).size, 5000);
});

test('create: validation, 2 KB limit, only c= and i=, p= never', () => {
  const s = mk();
  for (const bad of [null, [], 'x', {}, { f: 5 }, { f: '' }, { f: 'x=abc' }, { f: 'c=a b' }, { f: 'c=<script>' }, { f: 'i=Quiz' }, { f: 'c=abc&d=1' }]) assert.equal(s.create(bad).status, 400, JSON.stringify(bad));
  const secret = s.create({ f: 'p=c2VjcmV0LXNsb3Qta2V5' });
  assert.equal(secret.status, 400); assert.equal(s._state.links.size, 0, 'collaboration links hold a key and are never stored');
  assert.equal(s.create({ f: 'c=' + 'A'.repeat(MAX_FRAGMENT) }).status, 413);
  assert.equal(s.create({ f: 'c=' + 'A'.repeat(MAX_FRAGMENT - 2) }).status, 201);
  assert.equal(s.create({ f: 'i=quiz-chaos' }).status, 201);
  const r = s.create({ f: F, k: 'nonsense', n: 7, l: 'fr' });
  assert.equal(r.body.url, `https://bunsenbrenner.org/s/${r.body.id}`);
  const rec = s._state.links.get(r.body.id);
  assert.deepEqual([rec.k, rec.n, rec.l], ['idea', null, 'de'], 'unknown mechanic, score outside a game and unknown language are dropped');
  assert.equal(s.create({ f: F, k: 'game', n: -1 }).status, 201);
  assert.equal(s.create({ f: F, k: 'game', n: 1.5 }).status, 201);
});

test('storage: survives a restart, half written last line is skipped, file is private, no IP inside', () => {
  const d = dir();
  const a = mk({ SHORT_DATA_DIR: d });
  const r = a.create({ f: F, k: 'game', n: 42, l: 'en' }, 'hashed-client');
  appendFileSync(a._file(), '{"id":"half');
  assert.equal(statSync(a._file()).mode & 0o777, 0o600);
  const raw = readFileSync(a._file(), 'utf8');
  assert.ok(!raw.includes(r.body.token), 'token is stored as hash only');
  assert.ok(!/hashed-client|127\.0\.0\.1|"ip"/.test(raw), 'nothing about the client');
  const b = mk({ SHORT_DATA_DIR: d });
  assert.equal(b.lookup(r.body.id).f, F);
  assert.equal(b.remove(r.body.id, r.body.token).status, 204, 'token works after a restart');
});

test('storage: without SHORT_DATA_DIR or with an unusable one the service is off, 503, so the app keeps the long link', () => {
  const off = createShortLinks({ env: {}, log: () => {} });
  assert.equal(off.create({ f: F }).status, 503);
  const f = join(dir(), 'file'); writeFileSync(f, 'x');
  const events = [];
  const bad = createShortLinks({ env: { SHORT_DATA_DIR: join(f, 'sub') }, log: (e) => events.push(e.event) });
  assert.equal(bad.enabled(), false); assert.equal(bad.create({ f: F }).status, 503);
  assert.deepEqual(events, ['shortlink-off']);
});

test('limits: per client, per day, live cap; a new day opens again', () => {
  let t = Date.UTC(2026, 9, 31, 12);
  const s = mk({ SHORT_IP_PER_HOUR: '2', SHORT_DAILY_MAX: '4', SHORT_MAX_LIVE: '5' }, { now: () => t });
  assert.equal(s.create({ f: F }, 'a').status, 201); assert.equal(s.create({ f: F }, 'a').status, 201);
  const r = s.create({ f: F }, 'a');
  assert.equal(r.status, 429); assert.equal(r.body.error, 'rate-limited'); assert.ok(r.headers['Retry-After']);
  assert.equal(s.create({ f: F }, 'b').status, 201); assert.equal(s.create({ f: F }, 'c').status, 201);
  assert.equal(s.create({ f: F }, 'd').body.error, 'daily-limit');
  t += DAY;
  assert.equal(s.create({ f: F }, 'd').status, 201);
  assert.equal(s.create({ f: F }, 'e').body.error, 'full');
});

test('expiry: after 90 days the content is gone from disk and the page is friendly (410), later it is plain unknown', async () => {
  let t = Date.UTC(2026, 0, 1);
  const s = mk({}, { now: () => t });
  const r = s.create({ f: F, k: 'card' });
  const h = await serve(s);
  assert.equal((await fetch(`${h.base}/s/${r.body.id}`)).status, 200);
  t += 90 * DAY - 1;
  assert.equal((await fetch(`${h.base}/s/${r.body.id}`)).status, 200, 'still there one millisecond before');
  t += 1;
  const gone = await fetch(`${h.base}/s/${r.body.id}`);
  assert.equal(gone.status, 410);
  const html = await gone.text();
  assert.match(html, /abgelaufen/); assert.match(html, /href="\/duell"/); assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes(F));
  assert.equal((await fetch(`${h.base}/api/s/${r.body.id}`)).status, 410);
  t += 3600000; // the sweep runs at most hourly; until then the content is already not served
  await fetch(`${h.base}/s/${r.body.id}`);
  assert.ok(!readFileSync(s._file(), 'utf8').includes(F), 'content erased from the file');
  t += 31 * DAY;
  assert.equal((await fetch(`${h.base}/s/${r.body.id}`)).status, 404);
  assert.equal(readFileSync(s._file(), 'utf8'), '', 'tombstone removed as well');
  h.close();
});

test('delete: only with the token, content leaves the disk at once, repeated delete says gone', async () => {
  const s = mk(); const h = await serve(s);
  const { id, token } = await (await post(h.base, { f: F })).json();
  const del = (tok) => fetch(`${h.base}/api/s/${id}`, { method: 'DELETE', headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
  assert.equal((await del()).status, 403);
  assert.equal((await del('x'.repeat(32))).status, 403);
  assert.equal((await fetch(`${h.base}/api/s/${id}`)).status, 200, 'a wrong token changes nothing');
  assert.equal((await del(token)).status, 204);
  assert.ok(!readFileSync(s._file(), 'utf8').includes(F));
  assert.equal((await fetch(`${h.base}/s/${id}`)).status, 410);
  assert.equal((await del(token)).status, 410);
  assert.equal((await fetch(`${h.base}/api/s/22222222`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })).status, 404);
  h.close();
});

test('http: methods, media type, size, bad JSON', async () => {
  const s = mk(); const h = await serve(s);
  assert.equal((await post(h.base, '{nope')).status, 400);
  assert.equal((await post(h.base, { f: F }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(h.base, JSON.stringify({ f: 'c=' + 'A'.repeat(5000) }))).status, 413);
  assert.equal((await fetch(`${h.base}/api/s`)).status, 405);
  assert.equal((await fetch(`${h.base}/api/s/22222222`, { method: 'PUT' })).status, 405);
  assert.equal((await fetch(`${h.base}/s/22222222`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${h.base}/s/img/game.jpg`, { method: 'POST' })).status, 405);
  h.close();
});

test('cors: app origins and same host pass, foreign sites do not', async () => {
  const s = mk(); const h = await serve(s);
  for (const o of ['https://appassets.androidplatform.net', 'null']) {
    const r = await post(h.base, { f: F }, { Origin: o });
    assert.equal(r.status, 201); assert.equal(r.headers.get('access-control-allow-origin'), o);
    const pre = await fetch(`${h.base}/api/s`, { method: 'OPTIONS', headers: { Origin: o } });
    assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-methods'), /DELETE/); assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  }
  assert.equal((await post(h.base, { f: F }, { Origin: 'https://evil.example' })).status, 403);
  h.close();
});

test('page: Open Graph for WhatsApp, no meta refresh, no user text, script pinned by CSP hash, fragment in the link', async () => {
  const s = mk(); const h = await serve(s);
  const { id } = await (await post(h.base, { f: F, k: 'game', n: 42, l: 'de' })).json();
  const r = await fetch(`${h.base}/s/${id}`, { headers: { 'User-Agent': 'WhatsApp/2.23.20.0 A' } });
  assert.equal(r.status, 200); assert.equal(r.redirected, false);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  const og = (p) => html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`))?.[1];
  assert.equal(og('title'), 'Schlag meine 42 Punkte!');
  assert.ok(og('description').length > 10);
  assert.equal(og('image'), 'https://demos-34a13a96.bunsenbrenner.org/s/img/game.jpg');
  assert.equal(og('url'), `https://demos-34a13a96.bunsenbrenner.org/s/${id}`, 'names the fetched page: the portal address would redirect back to here');
  assert.equal(og('image:width'), '1200');
  assert.ok(html.indexOf('og:image') < 3000, 'tags right at the start');
  assert.ok(!/http-equiv=.?refresh/i.test(html), 'a crawler must stay on this page');
  assert.ok(html.includes(`href="/duell#${F}"`));
  const csp = r.headers.get('content-security-policy');
  const { createHash } = await import('node:crypto');
  assert.ok(csp.includes(`'sha256-${createHash('sha256').update(OPEN_SCRIPT).digest('base64')}'`));
  assert.ok(html.includes(`<script>${OPEN_SCRIPT}</script>`));
  assert.ok(!/script-src[^;]*unsafe/.test(csp));
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  h.close();
});

test('page: every mechanic has its title and picture; a picture fits WhatsApp (JPEG, 1200x630, under 300 KB, plain 200)', async () => {
  const s = mk(); const h = await serve(s);
  for (const [k, re] of [['game', /Schaffst du/], ['photo', /Bild/], ['sound', /Hör/], ['card', /Karte/], ['idea', /Idee/]]) {
    const { id } = await (await post(h.base, { f: F, k })).json();
    assert.match(await (await fetch(`${h.base}/s/${id}`)).text(), re);
    const img = await fetch(`${h.base}/s/img/${k}.jpg`, { redirect: 'manual' });
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
    const b = Buffer.from(await img.arrayBuffer());
    assert.ok(b.length < 300 * 1024, `${k}: ${b.length}`);
    assert.deepEqual([...b.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    let i = 2, size = null;
    while (i < b.length && !size) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc2) size = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + len; }
    assert.deepEqual(size, [1200, 630]);
  }
  for (const bad of ['evil.jpg', '..%2Fserver.jpg', 'game.png']) assert.equal((await fetch(`${h.base}/s/img/${bad}`)).status, 404);
  h.close();
});

test('page: HEAD answers like GET without a body; english; unknown and malformed ids are friendly', async () => {
  const s = mk(); const h = await serve(s);
  const { id } = await (await post(h.base, { f: F, k: 'card', l: 'en' })).json();
  const head = await fetch(`${h.base}/s/${id}`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.ok(Number(head.headers.get('content-length')) > 500);
  assert.equal((await fetch(`${h.base}/s/22222222`, { method: 'HEAD' })).status, 404);
  assert.match(await (await fetch(`${h.base}/s/${id}`)).text(), /My card of the day/);
  for (const bad of ['22222222', 'short', '0OIl0OIl', '%3Cscript%3E', 'a/b/c']) {
    const r = await fetch(`${h.base}/s/${bad}`);
    assert.equal(r.status, 404, bad);
    const html = await r.text();
    assert.match(html, /kennen wir nicht/); assert.ok(!html.includes('<script'));
  }
  assert.match(await (await fetch(`${h.base}/s/22222222`, { headers: { 'Accept-Language': 'en-GB' } })).text(), /do not know/);
  h.close();
});

test('guessing: too many unknown ids block that client, also for ids that exist; other clients are untouched', async () => {
  let who = 'guesser';
  const s = mk({ SHORT_MISS_PER_HOUR: '3' }, { clientKey: () => who }); const h = await serve(s);
  const { id } = s.create({ f: F }).body;
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${h.base}/s/2222222${i + 2}`)).status, 404);
  const blocked = await fetch(`${h.base}/s/${id}`);
  assert.equal(blocked.status, 429); assert.ok(blocked.headers.get('retry-after')); assert.ok(!(await blocked.text()).includes(F));
  assert.equal((await fetch(`${h.base}/api/s/${id}`)).status, 429);
  who = 'someone-else';
  assert.equal((await fetch(`${h.base}/s/${id}`)).status, 200);
  h.close();
});

test('api: app shells get the fragment for an id', async () => {
  const s = mk(); const h = await serve(s);
  const { id, exp } = await (await post(h.base, { f: F })).json();
  assert.deepEqual(await (await fetch(`${h.base}/api/s/${id}`)).json(), { f: F, exp });
  assert.equal((await fetch(`${h.base}/api/s/22222222`)).status, 404);
  h.close();
});

test('wiring: uses the salted client key of Duell, and the route is ours only for its paths', async () => {
  const d = createDuell({ env: { DUELL_IP_HEADER: 'x-forwarded-for' }, salt: 's', log: () => {}, llm: async () => '' });
  const key = d.clientKey({ headers: { 'x-forwarded-for': '203.0.113.9' }, socket: {} });
  assert.match(key, /^[0-9a-f]{16}$/); assert.ok(!key.includes('203'));
  const s = mk(); const h = await serve(s);
  assert.equal((await fetch(`${h.base}/sonst`)).status, 599);
  h.close();
});
