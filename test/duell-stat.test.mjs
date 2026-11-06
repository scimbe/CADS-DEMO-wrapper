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
const SALT = 'test-salt-' + 'x'.repeat(24);
const quiet = () => {};
const mk = (over = {}) => {
  let t = over.t ?? T0;
  const s = createStats({ env: { DUELL_STAT_FILE: over.file ?? '', DUELL_STAT_SALT: SALT, ...(over.env || {}) }, shared: {}, now: () => t, log: over.log ?? quiet, debounceMs: over.debounceMs ?? 5000 });
  return { s, at: (x) => { t = x; } };
};
const one = (s, i) => s.read(30).cards.find((c) => c.i === i);
const raw = (s, d, i) => s._buckets()[d][i];
const ud = (s, i = 'k') => [raw(s, '2026-11-06', i).up, raw(s, '2026-11-06', i).down];
const plain = (o) => JSON.parse(JSON.stringify(o));

test('Zaehlung: open, share, remix mit Bereichen; Abfrage ab 5 sichtbar, darunter null', () => {
  const { s, at } = mk();
  for (let n = 0; n < 5; n++) {
    s.record(parseEvent({ i: 'karte-1', e: 'open' }), { client: 'c' + n });
    s.record(parseEvent({ i: 'karte-1', e: 'share', w: ['text', 'beat', 'text', 'unbekannt'] }), { client: 'c' + n });
  }
  for (let n = 0; n < 4; n++) s.record(parseEvent({ i: 'karte-1', e: 'share', w: [] }), { client: 'd' + n });
  assert.deepEqual(plain(raw(s, '2026-11-06', 'karte-1')), { share: 9, remix: 5, open: 5, up: 0, down: 0, w: { text: 5, beat: 5 } });
  assert.deepEqual(one(s, 'karte-1'), { i: 'karte-1', share: 9, remix: 5, open: 5, up: null, down: null, w: { text: 5, beat: 5 } });
  s.record(parseEvent({ i: 'own', e: 'share', w: ['idee'] }), { client: 'c0' });
  at(T0 + 61000);                                                              // public read is cached for 60 s
  assert.deepEqual(one(s, 'own'), { i: 'own', share: null, remix: null, open: null, up: null, down: null, w: {} });   // w keys below k are left out
});

test('k-Schwelle: 4 bleibt null, 5 erscheint; Sortierung nach share ohne kleine Werte zu verraten', () => {
  const b = cleanBuckets({ '2026-11-06': { a: { share: 4, open: 5 }, b: { share: 6 }, c: { share: 1 } }, '2026-11-05': { a: { share: 1 } } });
  assert.deepEqual(summarize(b, '2026-11-06', 1).cards.map((c) => [c.i, c.share, c.open]), [['b', 6, null], ['a', null, 5], ['c', null, null]]);
  assert.deepEqual(summarize(b, '2026-11-06', 2).cards.map((c) => [c.i, c.share]), [['b', 6], ['a', 5], ['c', null]]);
  const w = summarize(cleanBuckets({ '2026-11-06': { a: { share: 5, w: { text: 5, foto: 4 } } } }), '2026-11-06', 7).cards[0].w;
  assert.deepEqual(w, { text: 5 });
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

test('Vote: Differenz alt -> neu, +1 -> -1 -> 0 exakt auch ueber mehrere Tage', () => {
  const { s, at } = mk();
  const vote = (v, account = 'a@x.de') => s.record(parseEvent({ i: 'k', e: 'vote', v }), { account });
  for (let n = 0; n < 5; n++) vote(1, `u${n}@x.de`);
  assert.equal(vote(1), 'ok');                                                 // day 1: +1
  at(T0 + 86400000); assert.equal(vote(-1), 'ok');                             // day 2: -1
  at(T0 + 2 * 86400000); assert.equal(vote(0), 'ok');                          // day 3: 0
  assert.equal(vote(0), 'same');                                                // no change: not an event
  const day = (d) => plain(raw(s, d, 'k'));
  assert.deepEqual([day('2026-11-06').up, day('2026-11-06').down], [6, 0]);
  assert.deepEqual([day('2026-11-07').up, day('2026-11-07').down], [-1, 1]);
  assert.deepEqual([day('2026-11-08').up, day('2026-11-08').down], [0, -1]);
  const sum = summarize(s._buckets(), '2026-11-08', 7).cards[0];
  assert.deepEqual([sum.up, sum.down], [5, null]);                             // exactly the five others
  assert.equal(s._votes().size, 5);
});

test('hoechstens 3 Wechsel je Konto, Karte und Tag; am naechsten Tag wieder', () => {
  const { s, at } = mk();
  const vote = (v) => s.record(parseEvent({ i: 'k', e: 'vote', v }), { account: 'a@x.de' });
  assert.deepEqual([vote(1), vote(-1), vote(1)], ['ok', 'ok', 'ok']);
  const before = plain(raw(s, '2026-11-06', 'k'));
  assert.equal(vote(-1), 'dup');
  assert.deepEqual(plain(raw(s, '2026-11-06', 'k')), before);
  assert.deepEqual([before.up, before.down], [1, 0]);
  at(T0 + 86400000); assert.equal(vote(-1), 'ok');
});

test('Angriff: Konto ohne Vorstimme mit v:0 bzw. v:-1 entfernt keine fremde Stimme', () => {
  const { s, at } = mk();
  for (let n = 0; n < 5; n++) assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { account: `u${n}@x.de` }), 'ok');
  const evil = { account: 'evil@x.de' };
  for (let n = 0; n < 10; n++) assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 0, p: 1 }), evil), 'same');
  assert.deepEqual(ud(s), [5, 0]);
  assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: -1, p: 1 }), evil), 'ok');
  assert.deepEqual(ud(s), [5, 1]);                                             // its own down vote, nothing taken from up
  at(T0 + 86400000);
  assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 0, p: 1 }), { account: 'new@x.de' }), 'same');
  assert.deepEqual(summarize(s._buckets(), '2026-11-07', 7).cards[0].up, 5);
  // the same account cannot add a second +1
  assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { account: 'u0@x.de' }), 'same');
});

test('ohne DUELL_STAT_SALT oder bei Gate-Ausfall keine Votes', () => {
  const { s } = mk({ env: { DUELL_STAT_SALT: '' } });
  assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { account: 'a@x.de' }), 'unavailable');
  const b = mk().s;
  assert.equal(b.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { unavailable: true }), 'unavailable');
  assert.equal(b._votes().size, 0);
});

test('ungueltige Eingaben; unbekannte Bereiche werden ignoriert', () => {
  const bad = [null, [], 'x', {}, { i: 'k' }, { e: 'open' }, { i: 'K', e: 'open' }, { i: 'a'.repeat(33), e: 'open' }, { i: 'a_b', e: 'open' },
    { i: 'k', e: 'like' }, { i: 'k', e: 'share', w: 'text' }, { i: 'k', e: 'share', w: Array(33).fill('text') },
    { i: 'k', e: 'vote' }, { i: 'k', e: 'vote', v: 2 }, { i: 'k', e: 'vote', v: '1' }];
  for (const b of bad) assert.equal(parseEvent(b), null, JSON.stringify(b));
  assert.deepEqual(parseEvent({ i: 'own', e: 'vote', v: -1 }), { i: 'own', e: 'vote', w: [], v: -1 });
  assert.deepEqual(parseEvent({ i: 'k', e: 'vote', v: 1, p: 'egal' }), { i: 'k', e: 'vote', w: [], v: 1 });   // p is ignored
  assert.deepEqual(parseEvent({ i: 'a-1', e: 'share', w: ['regeln', 'regeln', 'sound', 7, 'stimme'] }).w, ['regeln', 'stimme']);
  assert.deepEqual(parseEvent({ i: 'k', e: 'open', w: ['text'], v: 1 }), { i: 'k', e: 'open', w: [], v: 0 });
  for (const a of ['beat', 'stimme', 'idee']) assert.ok(AREAS.includes(a));
});

test('Prototype-Pollution: constructor/__proto__ als Karte oder im Speicher bleiben harmlos', () => {
  const { s } = mk();
  for (let n = 0; n < 5; n++) s.record(parseEvent({ i: 'constructor', e: 'open' }), { client: 'c' + n });
  assert.equal(raw(s, '2026-11-06', 'constructor').open, 5);
  assert.equal(({}).constructor, Object);
  const b = cleanBuckets(JSON.parse('{"__proto__":{"x":1},"2026-11-06":{"__proto__":{"open":9},"toString":{"open":9},"k":{"open":"9","up":-3,"w":{"text":2,"__proto__":5,"hack":1}}}}'));
  assert.deepEqual(plain(b), { '2026-11-06': { k: { share: 0, remix: 0, open: 0, up: -3, down: 0, w: { text: 2 } } } });   // up/down are differences: negative stays
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
    // votes.json: only HMACs -> 1|-1, no account, no card id in clear
    const vtext = readFileSync(join(dir, 'sub', 'votes.json'), 'utf8'), vj = JSON.parse(vtext);
    assert.equal(Object.keys(vj).length, 5);
    for (const [k, v] of Object.entries(vj)) { assert.match(k, /^[A-Za-z0-9_-]{43}$/); assert.equal(v, 1); }
    assert.doesNotMatch(vtext, /@|x\.de|u[0-4]|"k"/);
    const b = mk({ file });
    assert.equal(one(b.s, 'k').up, 5);
    assert.equal(b.s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { account: 'u0@x.de' }), 'same');   // the vote survived the restart
    assert.equal(b.s.record(parseEvent({ i: 'k', e: 'vote', v: 0 }), { account: 'u0@x.de' }), 'ok');
    assert.equal(b.s._buckets()['2026-11-06'].k.up, 4);
    b.at(T0 + 400 * 86400000);
    b.s.record(parseEvent({ i: 'k', e: 'open' }), { client: 'c0' });
    b.s.flush();
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8'))), ['2027-12-11']);
    assert.equal(Object.keys(JSON.parse(readFileSync(join(dir, 'sub', 'votes.json'), 'utf8'))).length, 4);   // votes stay for good
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

test('GET-Ergebnis wird 60 s gecacht, auch ueber neue Stimmen hinweg; readAdmin ohne Cache', () => {
  const { s, at } = mk();
  for (let n = 0; n < 5; n++) s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { account: `u${n}@x.de` });
  const r1 = s.read(30);
  assert.equal(r1.cards[0].up, 5);
  assert.equal(s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { account: 'u5@x.de' }), 'ok');
  at(T0 + 59000);
  assert.strictEqual(s.read(30), r1);                                          // the new vote does not show yet
  assert.equal(s.read(30).cards[0].up, 5);
  assert.equal(s.readAdmin(30).cards[0].up, 6);                                // reviewer view: at once
  at(T0 + 61000);
  assert.equal(s.read(30).cards[0].up, 6);
});

test('X-Stat same: gespeicherte Stimme erneut (zweites Geraet) ist kein Wechsel', () => {
  const { s } = mk();
  const vote = (v) => s.record(parseEvent({ i: 'k', e: 'vote', v }), { account: 'a@x.de' });
  assert.equal(vote(1), 'ok');
  for (let n = 0; n < 5; n++) assert.equal(vote(1), 'same');                  // second device sends the same vote
  assert.deepEqual(ud(s), [1, 0]);
  assert.deepEqual([vote(-1), vote(1)], ['ok', 'ok']);                         // changes 2 and 3 still possible
  assert.equal(vote(1), 'same');
  assert.equal(vote(-1), 'dup');                                               // 4th change
  assert.deepEqual(ud(s), [1, 0]);
});

test('readAdmin: ohne k-Maske, nur feste Fenster, nur Zaehler', () => {
  const { s, at } = mk();
  s.record(parseEvent({ i: 'k', e: 'share', w: ['text', 'foto'] }), { client: 'c1' });
  s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), { account: 'a@x.de' });
  s.record(parseEvent({ i: 'z', e: 'open' }), { client: 'c1' });
  const r = s.readAdmin(7);
  assert.deepEqual(r, { days: 7, cards: [
    { i: 'k', share: 1, remix: 1, open: 0, up: 1, down: 0, w: { text: 1, foto: 1 } },
    { i: 'z', share: 0, remix: 0, open: 1, up: 0, down: 0, w: {} }] });
  assert.equal(one(s, 'k').share, null);                                       // the public read stays masked
  for (const d of [0, 1, 14, 400, 30.5, '30', undefined]) assert.equal(s.readAdmin(d), null, String(d));
  for (const d of [30, 90, 365]) assert.equal(s.readAdmin(d).cards.length, 2);
  const text = JSON.stringify(s.readAdmin(365)), hmacs = [...s._votes().keys()];
  assert.equal(hmacs.length, 1);
  for (const h of hmacs) assert.ok(!text.includes(h));
  assert.doesNotMatch(text, /[A-Za-z0-9_-]{43}|@/);                           // no HMAC, no account
  at(T0 + 86400000); s.record(parseEvent({ i: 'k', e: 'vote', v: 0 }), { account: 'a@x.de' });
  assert.equal(s.readAdmin(7).cards.find((c) => c.i === 'k').up, 0);
  assert.equal(s.readAdmin(7).cards.find((c) => c.i === 'k').share, 1);
});

// HTTP through the real auth module: the gate is a stub; a forged X-Gate-Email request header is never read.
async function serve(statEnv = {}) {
  const env = { DUELL_IP_HEADER: 'x-forwarded-for', DUELL_CORS_ORIGINS: 'https://appassets.androidplatform.net' };
  const duell = createDuell({ env, llm: async () => ({}), log: quiet });
  const gate = async (url, o) => {
    if (/ct_gate_session=down/.test(o.headers.cookie || '')) throw new Error('gate down');
    const m = /ct_gate_session=ok-([a-z0-9]+)/.exec(o.headers.cookie || '');
    return { status: m ? 200 : 401, headers: new Headers(m ? { 'x-gate-email': `${m[1]}@x.de` } : {}) };
  };
  const auth = createAuth({ env: { DEMO_AUTH_MODE: 'gate', DEMO_GATE_HOST: 'demos.test' }, fetchImpl: gate, log: quiet });
  const stats = createStats({ env: { DUELL_STAT_FILE: '', DUELL_STAT_SALT: SALT, ...statEnv }, shared: duell.shared, auth, log: quiet });
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
    assert.equal(r.headers.get('access-control-expose-headers'), 'X-Stat');
    r = await post({ i: 'k', e: 'vote', v: 1 }, { cookie: 'ct_gate_session=down' });
    assert.equal(r.headers.get('x-stat'), 'unavailable');
    assert.equal((await post({ i: 'k', e: 'share' })).headers.get('x-stat'), 'dup');
    assert.equal(stats._buckets()['2026-11-06'].k.up, 0);
    for (let n = 0; n < 5; n++) {
      r = await post({ i: 'k', e: 'vote', v: 1 }, { cookie: `ct_gate_session=ok-u${n}` });
      assert.equal(r.status, 204); assert.equal(r.headers.get('x-stat'), null);
    }
    // 4th change of one account: X-Stat dup, counters unchanged
    const me = { cookie: 'ct_gate_session=ok-me', ip: '203.0.113.50' };
    const xs = []; for (const v of [-1, 1, -1, 1]) xs.push((await post({ i: 'k', e: 'vote', v }, me)).headers.get('x-stat'));
    assert.deepEqual(xs, [null, null, null, 'dup']);
    assert.equal((await post({ i: 'k', e: 'vote', v: -1 }, me)).headers.get('x-stat'), 'same');   // stored already: same, not dup
    assert.deepEqual([stats._buckets()['2026-11-06'].k.up, stats._buckets()['2026-11-06'].k.down], [5, 1]);
    const g = await fetch(base + '?days=7', { headers: { origin: 'https://appassets.androidplatform.net', 'x-forwarded-for': '198.51.100.9' } });
    assert.equal(g.status, 200);
    assert.equal(g.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');
    assert.equal(g.headers.get('access-control-allow-credentials'), null);
    assert.match(g.headers.get('cache-control'), /max-age=60/);
    assert.deepEqual(await g.json(), { days: 7, cards: [{ i: 'k', share: 5, remix: 5, open: null, up: 5, down: null, w: { stil: 5 } }] });   // down 1: below k
    assert.equal((await fetch(base, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await post({ i: 'k', e: 'open' }, { origin: 'https://evil.example' })).status, 403);
    for (const d of ['0', '1', '14', '400', '1.5', 'x']) assert.equal((await fetch(base + '?days=' + d)).status, 400, d);
    for (const d of ['7', '30', '90', '365']) assert.equal((await fetch(base + '?days=' + d, { headers: { 'x-forwarded-for': '198.51.100.' + d } })).status, 200, d);
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
