// Card statistics: counting, dedupe per day/card/client, vote difference with floor 0, k>=5, bad input, file roundtrip, HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStats, parseEvent, summarize } from '../lib/duell-stat.mjs';
import { createDuell } from '../lib/duell.mjs';

const T0 = Date.parse('2026-11-06T10:00:00Z');
const quiet = () => {};
const mk = (over = {}) => {
  let t = over.t ?? T0;
  const s = createStats({ env: { DUELL_STAT_FILE: over.file ?? '', ...(over.env || {}) }, shared: {}, now: () => t, log: quiet, debounceMs: over.debounceMs ?? 5000 });
  return { s, at: (x) => { t = x; } };
};
const one = (s, i) => s.read(30).cards.find((c) => c.i === i);
const raw = (s, d, i) => s._buckets()[d][i];

test('Zaehlung: open, share, remix mit Bereichen; Abfrage ab 5 sichtbar, darunter null', () => {
  const { s } = mk();
  for (let n = 0; n < 5; n++) {
    s.record(parseEvent({ i: 'karte-1', e: 'open' }), 'c' + n);
    s.record(parseEvent({ i: 'karte-1', e: 'share', w: ['text', 'farbe', 'text'] }), 'c' + n);
  }
  for (let n = 0; n < 4; n++) s.record(parseEvent({ i: 'karte-1', e: 'share', w: [] }), 'd' + n);
  assert.deepEqual(raw(s, '2026-11-06', 'karte-1'), { share: 9, remix: 5, open: 5, up: 0, down: 0, w: { text: 5, farbe: 5 } });
  assert.deepEqual(one(s, 'karte-1'), { i: 'karte-1', share: 9, remix: 5, open: 5, up: null, down: null, w: { text: 5, farbe: 5 } });
  s.record(parseEvent({ i: 'own', e: 'share', w: ['foto'] }), 'c0');
  assert.deepEqual(one(s, 'own'), { i: 'own', share: null, remix: null, open: null, up: null, down: null, w: { foto: null } });
});

test('k-Schwelle: 4 bleibt null, 5 erscheint; Sortierung nach share ohne kleine Werte zu verraten', () => {
  const b = { '2026-11-06': { a: { share: 4, remix: 0, open: 5, up: 0, down: 0, w: {} }, b: { share: 6, remix: 0, open: 0, up: 0, down: 0, w: {} }, c: { share: 1, remix: 0, open: 0, up: 0, down: 0, w: {} } },
    '2026-11-05': { a: { share: 1, remix: 0, open: 0, up: 0, down: 0, w: {} } }, '2026-10-01': { b: { share: 100, remix: 0, open: 0, up: 0, down: 0, w: {} } } };
  const r = summarize(b, '2026-11-06', 1);
  assert.deepEqual(r.cards.map((c) => [c.i, c.share, c.open]), [['b', 6, null], ['a', null, 5], ['c', null, null]]);
  assert.deepEqual(summarize(b, '2026-11-06', 2).cards.map((c) => [c.i, c.share]), [['b', 6], ['a', 5], ['c', null]]);
  assert.equal(summarize(b, '2026-11-06', 400).cards[0].share, 106);
});

test('Dedupe: open/share 1 je Tag, Karte und Client; neuer Tag zaehlt wieder', () => {
  const { s, at } = mk();
  assert.equal(s.record(parseEvent({ i: 'k', e: 'open' }), 'c1'), true);
  assert.equal(s.record(parseEvent({ i: 'k', e: 'open' }), 'c1'), false);
  assert.equal(s.record(parseEvent({ i: 'k', e: 'share' }), 'c1'), true);     // other event
  assert.equal(s.record(parseEvent({ i: 'k2', e: 'open' }), 'c1'), true);     // other card
  assert.equal(s.record(parseEvent({ i: 'k', e: 'open' }), 'c2'), true);      // other client
  assert.equal(raw(s, '2026-11-06', 'k').open, 2);
  at(T0 + 86400000);
  assert.equal(s.record(parseEvent({ i: 'k', e: 'open' }), 'c1'), true);
  assert.equal(raw(s, '2026-11-07', 'k').open, 1);
});

test('Vote: Differenz aus p und v, hoechstens 3 Aenderungen, Untergrenze 0', () => {
  const { s } = mk();
  const vote = (v, p, ck = 'c1') => s.record(parseEvent({ i: 'k', e: 'vote', v, p }), ck);
  assert.equal(vote(1, 0), true);
  assert.deepEqual([raw(s, '2026-11-06', 'k').up, raw(s, '2026-11-06', 'k').down], [1, 0]);
  assert.equal(vote(-1, 1), true);
  assert.deepEqual([raw(s, '2026-11-06', 'k').up, raw(s, '2026-11-06', 'k').down], [0, 1]);
  assert.equal(vote(-1, -1), false);                                            // no change, not counted
  assert.equal(vote(0, -1), true);
  assert.deepEqual([raw(s, '2026-11-06', 'k').up, raw(s, '2026-11-06', 'k').down], [0, 0]);
  assert.equal(vote(1, 0), false);                                              // 4th change today: 204, not counted
  assert.deepEqual([raw(s, '2026-11-06', 'k').up, raw(s, '2026-11-06', 'k').down], [0, 0]);
  // retracting a vote of yesterday: today's counter stays at 0, never below
  assert.equal(vote(0, 1, 'c2'), true);
  assert.equal(vote(1, -1, 'c3'), true);
  assert.deepEqual([raw(s, '2026-11-06', 'k').up, raw(s, '2026-11-06', 'k').down], [1, 0]);
});

test('ungueltige Eingaben', () => {
  const bad = [null, [], 'x', {}, { i: 'k' }, { e: 'open' }, { i: 'K', e: 'open' }, { i: 'a'.repeat(33), e: 'open' }, { i: 'a_b', e: 'open' },
    { i: 'k', e: 'like' }, { i: 'k', e: 'open', w: ['text'] }, { i: 'k', e: 'share', w: 'text' }, { i: 'k', e: 'share', w: ['sound'] },
    { i: 'k', e: 'vote' }, { i: 'k', e: 'vote', v: 2 }, { i: 'k', e: 'vote', v: '1' }, { i: 'k', e: 'vote', v: 1, p: 5 }, { i: 'k', e: 'open', v: 1 }, { i: 'k', e: 'share', p: 0 }];
  for (const b of bad) assert.equal(parseEvent(b), null, JSON.stringify(b));
  assert.deepEqual(parseEvent({ i: 'own', e: 'vote', v: -1 }), { i: 'own', e: 'vote', w: [], v: -1, p: 0 });
  assert.deepEqual(parseEvent({ i: 'a-1', e: 'share', w: ['regeln', 'regeln'] }).w, ['regeln']);
});

test('Persistenz: atomar geschrieben, nach Neustart wieder da, alte Tage fallen nach 400 Tagen heraus', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stat-')), file = join(dir, 'sub', 'stat.json');
  try {
    const a = mk({ file, debounceMs: 20 });
    for (let n = 0; n < 5; n++) a.s.record(parseEvent({ i: 'k', e: 'vote', v: 1 }), 'c' + n);
    assert.equal(existsSync(file), false);                                      // debounced
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(existsSync(file), true);
    assert.equal(existsSync(file + '.tmp'), false);
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(disk, { '2026-11-06': { k: { share: 0, remix: 0, open: 0, up: 5, down: 0, w: {} } } });
    assert.doesNotMatch(readFileSync(file, 'utf8'), /c[0-4]/);                  // no client key on disk
    const b = mk({ file });
    assert.equal(one(b.s, 'k').up, 5);
    b.at(T0 + 400 * 86400000);
    b.s.record(parseEvent({ i: 'k', e: 'open' }), 'c0');
    b.s.flush();
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8'))), ['2027-12-11']);
    // default location: next to state.json
    assert.equal(createStats({ env: { DUELL_AI_STATE_FILE: '/var/lib/duell-ai/state.json' }, shared: {}, log: quiet }).cfg.file, '/var/lib/duell-ai/stat.json');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP: 204, 400, 1 KB, Rate-Begrenzung, GET mit days und CORS', async () => {
  const env = { DUELL_IP_HEADER: 'x-forwarded-for', DUELL_CORS_ORIGINS: 'https://appassets.androidplatform.net' };
  const duell = createDuell({ env, llm: async () => ({}), log: quiet });
  const stats = createStats({ env: { DUELL_STAT_FILE: '', DUELL_STAT_PER_MIN: '8' }, shared: duell.shared, log: quiet });
  const srv = http.createServer(async (req, res) => { if (!(await stats.route(req, res, new URL(req.url, 'http://x')))) res.writeHead(404).end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/duell/stat`;
  const post = (body, ip = '203.0.113.1', h = {}) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...h }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    for (let n = 1; n <= 5; n++) assert.equal((await post({ i: 'k', e: 'share', w: ['stil'] }, '203.0.113.' + n)).status, 204);
    assert.equal((await post({ i: 'k', e: 'share' })).status, 204);                 // dedupe: still 204
    assert.equal((await post({ i: 'k', e: 'nope' })).status, 400);
    assert.equal((await post('{bad')).status, 400);
    assert.equal((await post({ i: 'k', e: 'open', pad: 'x'.repeat(1100) })).status, 413);
    const g = await fetch(base + '?days=7', { headers: { origin: 'https://appassets.androidplatform.net', 'x-forwarded-for': '198.51.100.9' } });
    assert.equal(g.status, 200);
    assert.equal(g.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');
    assert.deepEqual(await g.json(), { days: 7, cards: [{ i: 'k', share: 5, remix: 5, open: null, up: null, down: null, w: { stil: 5 } }] });
    const pre = await fetch(base, { method: 'OPTIONS', headers: { origin: 'https://appassets.androidplatform.net', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
    assert.equal((await fetch(base, { headers: { origin: 'https://evil.example' } })).status, 403);
    for (const d of ['0', '401', '1.5', 'x']) assert.equal((await fetch(base + '?days=' + d)).status, 400, d);
    assert.equal((await (await fetch(base)).json()).days, 30);
    let last = 0;
    for (let n = 0; n < 9; n++) last = (await post({ i: 'k', e: 'open' }, '192.0.2.77')).status;
    assert.equal(last, 429);
  } finally { srv.close(); }
});
