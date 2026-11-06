// Card statistics: counting, dedupe, votes only with a verified account (previous vote from memory, not the client),
// k>=5, bad input, file roundtrip (atomic, unreadable file kept), compaction, prototype safety, HTTP incl. CORS.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStats, parseEvent, summarize, compact, cleanBuckets, createLimiter, AREAS } from '../lib/duell-stat.mjs';
import { createDuell } from '../lib/duell.mjs';
import { createAuth } from '../lib/auth.mjs';

const T0 = Date.parse('2026-11-06T10:00:00Z');
const quiet = () => {};
const mk = (over = {}) => {
  let t = over.t ?? T0;
  const s = createStats({ env: { DUELL_STAT_FILE: over.file ?? '', ...(over.env || {}) }, shared: {}, now: () => t, log: over.log ?? quiet, debounceMs: over.debounceMs ?? 5000 });
  return { s, at: (x) => { t = x; } };
};
const one = (s, i) => s.read(30).cards.find((c) => c.i === i);
const raw = (s, d, i) => s._buckets()[d][i];
const ud = (s, i = 'k') => [raw(s, '2026-11-06', i).up, raw(s, '2026-11-06', i).down];
const plain = (o) => JSON.parse(JSON.stringify(o));

test('Zaehlung: open, share, remix mit Bereichen; Abfrage ab 5 sichtbar, darunter null', () => {
  const { s } = mk();
  for (let n = 0; n < 5; n++) {
    s.record(parseEvent({ i: 'karte-1', e: 'open' }), { client: 'c' + n });
    s.record(parseEvent({ i: 'karte-1', e: 'share', w: ['text', 'beat', 'text', 'unbekannt'] }), { client: 'c' + n });
  }
  for (let n = 0; n < 4; n++) s.record(parseEvent({ i: 'karte-1', e: 'share', w: [] }), { client: 'd' + n });
  assert.deepEqual(plain(raw(s, '2026-11-06', 'karte-1')), { share: 9, remix: 5, open: 5, up: 0, down: 0, w: { text: 5, beat: 5 } });
  assert.deepEqual(one(s, 'karte-1'), { i: 'karte-1', share: 9, remix: 5, open: 5, up: null, down: null, w: { text: 5, beat: 5 } });
  s.record(parseEvent({ i: 'own', e: 'share', w: ['idee'] }), { client: 'c0' });
  assert.deepEqual(one(s, 'own'), { i: 'own', share: null, remix: null, open: null, up: null, down: null, w: { idee: null } });
});

test('k-Schwelle: 4 bleibt null, 5 erscheint; Sortierung nach share ohne kleine Werte zu verraten', () => {
  const b = cleanBuckets({ '2026-11-06': { a: { share: 4, open: 5 }, b: { share: 6 }, c: { share: 1 } }, '2026-11-05': { a: { share: 1 } } });
  assert.deepEqual(summarize(b, '2026-11-06', 1).cards.map((c) => [c.i, c.share, c.open]), [['b', 6, null], ['a', null, 5], ['c', null, null]]);
  assert.deepEqual(summarize(b, '2026-11-06', 2).cards.map((c) => [c.i, c.share]), [['b', 6], ['a', 5], ['c', null]]);
});

test('Dedupe open/share: 1 je Tag, Karte und Client; neuer Tag zaehlt wieder', () => {
  const { s, at } = mk();
  const c1 = { client: 'c1' };
  assert.equal(s.record(parseEvent({ i: 'k', e: 'open' }), c1), 'ok');
  assert.equal(s.record(parseEvent({ i: 'k', e: 'open' }), c1), 'dup');
  assert.equal(s.record(parseEvent({ i: 'k', e: 'share' }), c1), 'ok');
  assert.equal(s.record(parseEvent({ i: 'k2', e: 'open' }), c1), 'ok');
  assert.equal(s.record(parseEvent({ i: 'k', e: 'open' }), { client: 'c2' }), 'ok');
  assert.equal(s.record(parseEvent({ i: 'k', e: 'open' }), { account: 'a@x.de' }), 'ok');   // no client key: the account dedupes
  assert.equal(s.record(parseEvent({ i: 'k', e: 'open' }), { account: 'a@x.de' }), 'dup');
  assert.equal(raw(s, '2026-11-06', 'k').open, 3);
  at(T0 + 86400000);
  assert.equal(s.record(parseEvent({ i: 'k', e: 'open' }), c1), 'ok');
  assert.equal(raw(s, '2026-11-07', 'k').open, 1);
});

test('open/share ohne Schluessel: zaehlen, aber nur unter dem engen Gesamtlimit', () => {
  const { s } = mk({ env: { DUELL_STAT_ANON_PER_MIN: '3', DUELL_STAT_ANON_PER_DAY: '1000' } });
  const r = []; for (let n = 0; n < 5; n++) r.push(s.record(parseEvent({ i: 'k', e: 'open' }), {}));
  assert.deepEqual(r, ['ok', 'ok', 'ok', 'full', 'full']);
  assert.equal(raw(s, '2026-11-06', 'k').open, 3);
});

test('Vote ohne Konto zaehlt nie, auch nicht mit Client-Schluessel', () => {
  const { s } = mk();
  assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), {}), 'login');
  assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { client: 'c1' }), 'login');
  assert.equal(s._buckets()['2026-11-06'], undefined);
});

test('Vote: vorherige Stimme aus dem Speicher, hoechstens 3 Aenderungen, Untergrenze 0', () => {
  const { s, at } = mk();
  const vote = (v, p, account = 'a@x.de') => s.record(parseEvent({ i: 'k', e: 'vote', v, p }), { account });
  assert.equal(vote(1, 0), 'ok'); assert.deepEqual(ud(s), [1, 0]);
  assert.equal(vote(-1, 0), 'ok'); assert.deepEqual(ud(s), [0, 1]);          // client claims p=0, server knows 1
  assert.equal(vote(-1, 1), 'dup'); assert.deepEqual(ud(s), [0, 1]);         // same vote again: no change
  assert.equal(vote(0, 0), 'ok'); assert.deepEqual(ud(s), [0, 0]);           // 3rd change
  assert.equal(vote(1, 0), 'dup'); assert.deepEqual(ud(s), [0, 0]);          // 4th: 204, not counted
  // a vote of yesterday, taken back today: the client's p counts once, today's counter never below 0
  at(T0 + 86400000);
  assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 0, p: 1 }), { account: 'b@x.de' }), 'ok');
  assert.deepEqual(plain(raw(s, '2026-11-07', 'k')), { share: 0, remix: 0, open: 0, up: 0, down: 0, w: {} });
});

test('Szenario B: fremde Stimmen loeschen geht nicht (p nur einmal, dann zaehlt der Speicher)', () => {
  const { s } = mk();
  for (let n = 0; n < 6; n++) assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { account: `u${n}@x.de` }), 'ok');
  assert.deepEqual(ud(s), [6, 0]);
  const evil = { account: 'evil@x.de' };
  const r = []; for (let n = 0; n < 10; n++) r.push(s.record(parseEvent({ i: 'k', e: 'vote', v: 0, p: 1 }), evil));
  assert.deepEqual(ud(s), [5, 0]);                                           // at most one, from the one-time p
  assert.equal(r.filter((x) => x === 'ok').length, 1);
  // up and back with the own vote changes nothing net, and the change budget ends
  s.record(parseEvent({ i: 'k', e: 'vote', v: 1, p: 0 }), evil);
  s.record(parseEvent({ i: 'k', e: 'vote', v: 0, p: 1 }), evil);
  assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: -1, p: 1 }), evil), 'dup');
  assert.deepEqual(ud(s), [5, 0]);
  // the same account cannot vote twice on a card on one day: the second +1 is no change
  assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 1, p: 0 }), { account: 'u0@x.de' }), 'dup');
  assert.deepEqual(ud(s), [5, 0]);
});

test('ungueltige Eingaben; unbekannte Bereiche werden ignoriert', () => {
  const bad = [null, [], 'x', {}, { i: 'k' }, { e: 'open' }, { i: 'K', e: 'open' }, { i: 'a'.repeat(33), e: 'open' }, { i: 'a_b', e: 'open' },
    { i: 'k', e: 'like' }, { i: 'k', e: 'share', w: 'text' }, { i: 'k', e: 'share', w: Array(33).fill('text') },
    { i: 'k', e: 'vote' }, { i: 'k', e: 'vote', v: 2 }, { i: 'k', e: 'vote', v: '1' }, { i: 'k', e: 'vote', v: 1, p: 5 }];
  for (const b of bad) assert.equal(parseEvent(b), null, JSON.stringify(b));
  assert.deepEqual(parseEvent({ i: 'own', e: 'vote', v: -1 }), { i: 'own', e: 'vote', w: [], v: -1, p: 0 });
  assert.deepEqual(parseEvent({ i: 'a-1', e: 'share', w: ['regeln', 'regeln', 'sound', 7, 'stimme'] }).w, ['regeln', 'stimme']);
  assert.deepEqual(parseEvent({ i: 'k', e: 'open', w: ['text'], v: 1 }), { i: 'k', e: 'open', w: [], v: 0, p: 0 });
  for (const a of ['beat', 'stimme', 'idee']) assert.ok(AREAS.includes(a));
});

test('Prototype-Pollution: constructor/__proto__ als Karte oder im Speicher bleiben harmlos', () => {
  const { s } = mk();
  for (let n = 0; n < 5; n++) s.record(parseEvent({ i: 'constructor', e: 'open' }), { client: 'c' + n });
  assert.equal(raw(s, '2026-11-06', 'constructor').open, 5);
  assert.equal(({}).constructor, Object);
  const b = cleanBuckets(JSON.parse('{"__proto__":{"x":1},"2026-11-06":{"__proto__":{"open":9},"toString":{"open":9},"k":{"open":"9","up":-3,"w":{"text":2,"__proto__":5,"hack":1}}}}'));
  assert.deepEqual(plain(b), { '2026-11-06': { k: { share: 0, remix: 0, open: 0, up: 0, down: 0, w: { text: 2 } } } });
  assert.equal(Object.getPrototypeOf(b), null);
  assert.equal(({}).open, undefined);
});

test('Verdichtung: aelter als 90 Tage als Monatssumme, aelter als 400 Tage weg, Monate je cardsMax gedeckelt', () => {
  const b = cleanBuckets({ '2026-11-06': { k: { share: 1 } }, '2026-08-01': { k: { share: 2 }, z: { open: 1 } }, '2026-08-02': { k: { share: 3 }, y: { share: 9 } },
    '2025-10-05': { k: { share: 50 } }, '2025-10-02': { k: { share: 99 } } });   // 399 days back is 2025-10-03
  compact(b, '2026-11-06', 2);
  assert.deepEqual(Object.keys(b).sort(), ['2025-10', '2026-08', '2026-11-06']);
  assert.deepEqual(Object.keys(b['2026-08']).sort(), ['k', 'y']);                       // busiest two kept
  assert.equal(b['2026-08'].k.share, 5);
  assert.equal(summarize(b, '2026-11-06', 400).cards.find((c) => c.i === 'k').share, 56);
  assert.equal(summarize(b, '2026-11-06', 30).cards.find((c) => c.i === 'k').share, null);
});

test('Limiter: getrennte Fenster, aelteste Eintraege fallen zuerst heraus', () => {
  let t = 0; const lim = createLimiter(2, { now: () => t, max: 3 });
  assert.deepEqual([lim('a'), lim('a'), lim('a')], [false, false, true]);
  lim('b'); lim('c'); lim('d');                    // 'a' is the oldest and goes
  assert.equal(lim('a'), false);
  assert.equal(lim('d'), false); assert.equal(lim('d'), true);   // 'd' kept its count
  t = 60000; assert.equal(lim('d'), false);
});

test('Persistenz: atomar, Roundtrip, unlesbare Datei wird als .bad-<ts> gesichert, nie ueberschrieben', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stat-')), file = join(dir, 'sub', 'stat.json');
  try {
    const a = mk({ file, debounceMs: 20 });
    for (let n = 0; n < 5; n++) a.s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { account: `u${n}@x.de` });
    assert.equal(existsSync(file), false);                                      // debounced
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(existsSync(file + '.tmp'), false);
    const text = readFileSync(file, 'utf8');
    assert.deepEqual(JSON.parse(text), { '2026-11-06': { k: { share: 0, remix: 0, open: 0, up: 5, down: 0, w: {} } } });
    assert.doesNotMatch(text, /@|u[0-4]/);                                      // no account, no key on disk
    const b = mk({ file });
    assert.equal(one(b.s, 'k').up, 5);
    b.at(T0 + 400 * 86400000);
    b.s.record(parseEvent({ i: 'k', e: 'open' }), { client: 'c0' });
    b.s.flush();
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8'))), ['2027-12-11']);
    // unreadable: moved aside, content intact, then a fresh file
    writeFileSync(file, '{kaputt');
    const logs = [], c = mk({ file, log: (o) => logs.push(o) });
    const bad = readdirSync(join(dir, 'sub')).filter((f) => f.startsWith('stat.json.bad-'));
    assert.equal(bad.length, 1);
    assert.equal(readFileSync(join(dir, 'sub', bad[0]), 'utf8'), '{kaputt');
    assert.ok(logs.some((o) => o.why === 'unreadable'));
    c.s.record(parseEvent({ i: 'k', e: 'open' }), { client: 'c0' }); c.s.flush();
    assert.equal(JSON.parse(readFileSync(file, 'utf8'))['2026-11-06'].k.open, 1);
    assert.equal(createStats({ env: { DUELL_AI_STATE_FILE: '/var/lib/duell-ai/state.json' }, shared: {}, log: quiet }).cfg.file, '/var/lib/duell-ai/stat.json');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GET-Ergebnis wird 60 s gecacht', () => {
  const { s, at } = mk();
  for (let n = 0; n < 5; n++) s.record(parseEvent({ i: 'k', e: 'open' }), { client: 'c' + n });
  const r1 = s.read(30);
  assert.strictEqual(s.read(30), r1);
  at(T0 + 61000);
  assert.notStrictEqual(s.read(30), r1);
});

// HTTP through the real auth module: the gate is a stub; a forged X-Gate-Email request header is never read.
async function serve(statEnv = {}) {
  const env = { DUELL_IP_HEADER: 'x-forwarded-for', DUELL_CORS_ORIGINS: 'https://appassets.androidplatform.net' };
  const duell = createDuell({ env, llm: async () => ({}), log: quiet });
  const gate = async (url, o) => {
    const m = /ct_gate_session=ok-([a-z0-9]+)/.exec(o.headers.cookie || '');
    return { status: m ? 200 : 401, headers: new Headers(m ? { 'x-gate-email': `${m[1]}@x.de` } : {}) };
  };
  const auth = createAuth({ env: { DEMO_AUTH_MODE: 'gate', DEMO_GATE_HOST: 'demos.test' }, fetchImpl: gate, log: quiet });
  const stats = createStats({ env: { DUELL_STAT_FILE: '', ...statEnv }, shared: duell.shared, auth, log: quiet });
  const srv = http.createServer(async (req, res) => { if (!(await stats.route(req, res, new URL(req.url, 'http://x')))) res.writeHead(404).end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/duell/stat`;
  const post = (body, { ip = '203.0.113.1', ...h } = {}) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...h }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { srv, base, post, stats };
}

test('HTTP: 204, 400, 413, Vote nur mit Konto (X-Stat: login), GET mit days, CORS', async () => {
  const { srv, base, post, stats } = await serve();
  try {
    for (let n = 1; n <= 5; n++) assert.equal((await post({ i: 'k', e: 'share', w: ['stil', 'neu'] }, { ip: '203.0.113.' + n })).status, 204);
    assert.equal((await post({ i: 'k', e: 'share' })).status, 204);                // dedupe: still 204
    assert.equal((await post({ i: 'k', e: 'nope' })).status, 400);
    assert.equal((await post('{bad')).status, 400);
    assert.equal((await post({ i: 'k', e: 'open', pad: 'x'.repeat(1100) })).status, 413);
    // vote without account: 204 + X-Stat: login, not counted; a forged identity header does not help
    let r = await post({ i: 'k', e: 'vote', v: 1 }, { 'x-gate-email': 'fake@x.de', cookie: 'ct_gate_session=forged' });
    assert.equal(r.status, 204); assert.equal(r.headers.get('x-stat'), 'login');
    assert.equal(stats._buckets()['2026-11-06'].k.up, 0);
    for (let n = 0; n < 5; n++) {
      r = await post({ i: 'k', e: 'vote', v: 1 }, { cookie: `ct_gate_session=ok-u${n}` });
      assert.equal(r.status, 204); assert.equal(r.headers.get('x-stat'), null);
    }
    const g = await fetch(base + '?days=7', { headers: { origin: 'https://appassets.androidplatform.net', 'x-forwarded-for': '198.51.100.9' } });
    assert.equal(g.status, 200);
    assert.equal(g.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');
    assert.equal(g.headers.get('access-control-allow-credentials'), null);
    assert.match(g.headers.get('cache-control'), /max-age=60/);
    assert.deepEqual(await g.json(), { days: 7, cards: [{ i: 'k', share: 5, remix: 5, open: null, up: 5, down: null, w: { stil: 5 } }] });
    assert.equal((await fetch(base, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await post({ i: 'k', e: 'open' }, { origin: 'https://evil.example' })).status, 403);
    for (const d of ['0', '401', '1.5', 'x']) assert.equal((await fetch(base + '?days=' + d)).status, 400, d);
  } finally { srv.close(); }
});

test('HTTP: Origin null nur fuer POST ohne Credentials (ACAO *), Lesen bleibt gesperrt', async () => {
  const { srv, base, post, stats } = await serve();
  try {
    const pre = await fetch(base, { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.equal(pre.headers.get('access-control-allow-methods'), 'POST');
    assert.equal(pre.headers.get('access-control-allow-credentials'), null);
    const r = await post({ i: 'n', e: 'open' }, { origin: 'null' });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(stats._buckets()['2026-11-06'].n.open, 1);
    // a cookie on a "null" request is not read: no vote
    const v = await post({ i: 'n', e: 'vote', v: 1 }, { origin: 'null', cookie: 'ct_gate_session=ok-u1' });
    assert.equal(v.headers.get('x-stat'), 'login');
    assert.equal((await fetch(base, { headers: { origin: 'null' } })).status, 403);
  } finally { srv.close(); }
});

test('HTTP: getrennte Grenzen fuer GET und POST', async () => {
  const { srv, base, post } = await serve({ DUELL_STAT_POST_PER_MIN: '3', DUELL_STAT_GET_PER_MIN: '2' });
  try {
    const ip = { 'x-forwarded-for': '192.0.2.77' };
    const p = []; for (let n = 0; n < 4; n++) p.push((await post({ i: 'k', e: 'open' }, { ip: '192.0.2.77' })).status);
    assert.deepEqual(p, [204, 204, 204, 429]);
    const g = []; for (let n = 0; n < 3; n++) g.push((await fetch(base, { headers: ip })).status);
    assert.deepEqual(g, [200, 200, 429]);
  } finally { srv.close(); }
});
