// "Aufladen per Gutschein" (lib/duell-voucher.mjs): a configured code adds credit to the login account (lib/duell-credit.mjs
// grant), within its limits; wrong codes are rate-limited; the code never appears in a log line or in the credit file.
// The codes here are dummies for the tests only; real codes exist only as hashes in DUELL_VOUCHERS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { createCredit } from '../lib/duell-credit.mjs';
import { createVouchers, parseVouchers } from '../lib/duell-voucher.mjs';

const CODE = 'TEST-CODE-1', ONCE = 'TEST-ONCE-2';
const H = (c) => createHash('sha256').update(c).digest('hex');
const ENV = `${H(CODE)}:5:2:100:1,${H(ONCE)}:3:5:100:0`;
const T0 = Date.UTC(2026, 10, 11, 9);

function setup({ vouchers = ENV, env = {} } = {}) {
  const clock = { t: T0 }, now = () => clock.t, lines = [];
  const log = (o) => lines.push(JSON.stringify(o));
  const dir = mkdtempSync(join(tmpdir(), 'duell-voucher-'));
  const d = createDuell({ env: { DUELL_SEAL_SECRET: 'seal', DUELL_IP_HEADER: 'x-ip' }, salt: 's', log, llm: async () => '{}', now });
  d.shared.age16 = () => true;
  const auth = { mode: 'gate', identify: async (req) => ({ email: (req && req.headers && req.headers['x-mail']) || null }) };
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: async () => '{}', shared: d.shared, auth, log, now });
  const credit = createCredit({ env: {}, now, log, file: join(dir, 'credit.json') });
  const v = createVouchers({ env: { ...(vouchers !== null ? { DUELL_VOUCHERS: vouchers } : {}), ...env }, shared: d.shared, who: ai.who, credit, now, log });
  Object.assign(d.shared, { credit, vouchers: v });
  return { clock, d, ai, credit, v, lines, dir };
}
async function serve(s) {
  const srv = http.createServer(async (q, r) => {
    const url = new URL(q.url, 'http://x');
    if (!(await s.v.route(q, r, url)) && !(await s.ai.route(q, r, url))) r.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (path, body, mail, ip = '203.0.113.7') => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ip': ip, ...(mail ? { 'x-mail': mail } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { post, redeem: (code, mail = 'lea@example.org', ip) => post('/api/duell/credit/redeem', { code }, mail, ip), close: () => new Promise((r) => srv.close(r)) };
}
const acct = async (s, mail = 'lea@example.org') => (await s.ai.who({ headers: { 'x-mail': mail } }, {})).acct;

test('Konfiguration: nur gueltige Eintraege, Hash in Kleinbuchstaben, sonst aus', () => {
  const { list, bad } = parseVouchers(`${H(CODE)}:5:2:100:1, nix, ${H(ONCE)}:0:1:1:1,${H(ONCE).toUpperCase()}:3:1:10:0`);
  assert.equal(list.length, 2); assert.equal(bad, 2);
  assert.deepEqual(list.map((x) => [x.amount, x.perAcct, x.global, x.reusable]), [[5, 2, 100, true], [3, 1, 10, false]]);
  assert.equal(parseVouchers('').list.length, 0);
});

test('Wiederholbarer Code: +5, nochmal +5, dann Tageslimit je Konto; am naechsten Tag wieder', async () => {
  const s = setup(), h = await serve(s);
  try {
    const r1 = await h.redeem(CODE);
    assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.deepEqual(r1.body, { ok: true, added: 5, credit: 5 });
    const r2 = await h.redeem('  test-code-1 ');   // uppercase and trimmed before the hash
    assert.deepEqual(r2.body, { ok: true, added: 5, credit: 10 });
    const r3 = await h.redeem(CODE);
    assert.equal(r3.status, 429); assert.deepEqual(r3.body, { ok: false, error: 'limit' });
    assert.equal(s.credit.available(await acct(s)), 10);
    s.clock.t += 86400000;
    assert.deepEqual((await h.redeem(CODE)).body, { ok: true, added: 5, credit: 15 }, 'a new UTC day');
    // the status shows the balance and that vouchers are on
    const st = await h.post('/api/duell/ai/status', {}, 'lea@example.org');
    assert.equal(st.body.create.credit, 15); assert.equal(st.body.create.voucher, true); assert.equal(st.body.create.remaining, 5);
  } finally { await h.close(); }
});

test('Einmal-Code: einmal je Konto, ein anderes Konto darf; globales Tageslimit', async () => {
  const s = setup({ vouchers: `${H(ONCE)}:3:5:2:0` }), h = await serve(s);
  try {
    assert.deepEqual((await h.redeem(ONCE)).body, { ok: true, added: 3, credit: 3 });
    assert.deepEqual((await h.redeem(ONCE)).body, { ok: false, error: 'limit' }, 'not reusable');
    s.clock.t += 3 * 86400000;
    assert.deepEqual((await h.redeem(ONCE)).body, { ok: false, error: 'limit' }, 'once per account, ever');
    assert.equal((await h.redeem(ONCE, 'ben@example.org')).body.added, 3);
    assert.equal((await h.redeem(ONCE, 'cem@example.org')).body.added, 3);
    assert.deepEqual((await h.redeem(ONCE, 'dan@example.org')).body, { ok: false, error: 'limit' }, 'global per day: 2');
  } finally { await h.close(); }
});

test('Falscher Code: unknown; nach 5 Fehlversuchen je Konto und je IP limit, auch fuer den richtigen Code', async () => {
  const s = setup(), h = await serve(s);
  try {
    const w = await h.redeem('FALSCH-1');
    assert.equal(w.status, 403); assert.deepEqual(w.body, { ok: false, error: 'unknown' });
    for (let i = 2; i <= 5; i++) assert.equal((await h.redeem('FALSCH-' + i)).body.error, 'unknown');
    assert.deepEqual((await h.redeem(CODE)).body, { ok: false, error: 'limit' }, 'account blocked for the hour');
    // same IP, other account: blocked too
    assert.equal((await h.redeem(CODE, 'ben@example.org')).body.error, 'limit', 'per IP');
    // other IP, other account: fine
    assert.equal((await h.redeem(CODE, 'ben@example.org', '198.51.100.2')).body.added, 5);
    // after the hour the account may try again
    s.clock.t += 3600000;
    assert.equal((await h.redeem(CODE)).body.added, 5);
    // a non-string, too short or too long code is a wrong attempt, never a crash
    for (const c of [123, null, 'ab', 'X'.repeat(65)]) assert.equal((await h.post('/api/duell/credit/redeem', { code: c }, 'eva@example.org', '192.0.2.9')).body.error, 'unknown');
  } finally { await h.close(); }
});

test('Ohne DUELL_VOUCHERS: off (auch angemeldet); ohne Login: login', async () => {
  const off = setup({ vouchers: null }), h = await serve(off);
  try {
    const r = await h.redeem(CODE);
    assert.equal(r.status, 503); assert.deepEqual(r.body, { ok: false, error: 'off' });
    assert.equal((await h.post('/api/duell/ai/status', {}, 'lea@example.org')).body.create.voucher, false);
  } finally { await h.close(); }
  const s = setup(), h2 = await serve(s);
  try {
    const r = await h2.post('/api/duell/credit/redeem', { code: CODE });
    assert.equal(r.status, 401); assert.deepEqual(r.body, { ok: false, error: 'login' });
    assert.equal(s.credit.granted(H(CODE).slice(0, 16)), 0);
  } finally { await h2.close(); }
});

test('Der Code steht nie im Log und nie in der Guthaben-Datei, nur 8 Zeichen des Hashs', async () => {
  const s = setup(), h = await serve(s);
  try {
    await h.redeem(CODE); await h.redeem('FALSCH-CODE'); await h.redeem(CODE); await h.redeem(CODE);
    s.credit.flush();
    const all = s.lines.join('\n') + '\n' + readFileSync(join(s.dir, 'credit.json'), 'utf8');
    for (const c of [CODE, CODE.toLowerCase(), 'FALSCH-CODE', H(CODE), H(CODE).slice(0, 20)]) assert.ok(!all.includes(c), 'leaked: ' + c);
    const ev = s.lines.map((l) => JSON.parse(l)).filter((o) => o.event === 'duell-voucher');
    assert.deepEqual(ev.map((o) => [o.ok, o.why || '', o.h || '']), [[true, '', H(CODE).slice(0, 8)], [false, 'unknown', ''], [true, '', H(CODE).slice(0, 8)], [false, 'limit', H(CODE).slice(0, 8)]]);
  } finally { await h.close(); }
});

test('Gutschein-Guthaben: zaehlt nicht gegen die Obergrenzen verdienten Guthabens, revoke nimmt es nicht', () => {
  const clock = { t: T0 }, c = createCredit({ env: { DUELL_CREDIT_YEAR_CAP: '4' }, now: () => clock.t, log: () => {}, file: '' });
  const k = 'a' + '0'.repeat(32), cid = 'C'.repeat(22);
  assert.equal(c.grant(k, 5, 'voucher', 'abcdef0123456789'), 5);
  assert.equal(c.award(k, cid, 'use'), 2, 'year cap 4 is for earned credit only');
  assert.equal(c.available(k), 7);
  assert.equal(c.revoke(cid, 'block'), 2); assert.equal(c.available(k), 5, 'the voucher stays');
  assert.equal(c.grant(k, 5, 'gift'), 0, 'only known grant reasons'); assert.equal(c.grant('bad', 5), 0); assert.equal(c.grant(k, 0), 0);
  assert.equal(c.view(k).items[0].cid, null);
  assert.ok(c.spend(k, 5)); assert.equal(c.available(k), 0);
});

test('Guthaben umgeht nichts: leerer Topf + Gutschein macht Karten, DUELL_CREATE_CALLS_PER_DAY gilt weiter', async () => {
  const { MOD_SYSTEM } = await import('../lib/duell-karte.mjs');
  const cardLlm = { configured: true, calls: 0, async generate(req) { this.calls++; if (req.system === MOD_SYSTEM) return { json: { risk: 0, cats: [] }, stop: 'end_turn', usage: { in: 1, out: 1 } }; return { json: { ok: true, title: 'Frosch', x: 'Ein Frosch fliegt.', st: 'herz', palette: 0, stickers: ['🐸'] }, stop: 'end_turn', usage: { in: 1, out: 1 } }; } };
  const clock = { t: T0 }, now = () => clock.t;
  const d = createDuell({ env: { DUELL_DAILY_MAX: '200', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: async () => '{}', now });
  d.shared.age16 = () => true; d.shared.age18 = () => false;
  const auth = { mode: 'gate', identify: async () => ({ email: 'lea@example.org' }) };
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0', DUELL_CREATE_FREE: '1', DUELL_CREATE_CALLS_PER_DAY: '9' }, llm: async () => '{}', cardLlm, shared: d.shared, auth, log: () => {}, now });
  const credit = createCredit({ env: {}, now, log: () => {}, file: '' });
  const v = createVouchers({ env: { DUELL_VOUCHERS: ENV }, shared: d.shared, who: ai.who, credit, now, log: () => {} });
  Object.assign(d.shared, { credit, vouchers: v });
  const body = (text) => ({ kind: 'karte', input: { text, art: 'card' }, device: 'd'.repeat(32), lang: 'de' });
  const p = await ai.who({}, body('x'));
  const run = async (t) => ai.act(body(t), p, null);
  assert.equal((await run('Ein Frosch im Weltall')).status, 200);
  assert.equal((await run('Noch ein Frosch')).body.error, 'quota', 'pot empty, no credit');
  assert.equal(v.redeem(p.acct, null, CODE).body.added, 5);
  const r = await run('Ein Frosch auf dem Mond');
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.credit, true); assert.equal(credit.available(p.acct), 4);
  // 3 calls are reserved per card: after 2 cards (<= 6 calls) the third would pass 9, so the daily cap answers
  const third = await run('Ein Frosch am Meer');
  assert.ok(third.status === 200 || third.body.error === 'daily-cap');
  const capped = await run('Ein Frosch im Wald');
  assert.equal(capped.status, 429); assert.equal(capped.body.error, 'daily-cap', 'credit does not lift the daily call cap');
  assert.ok(credit.available(p.acct) >= 3, 'nothing spent for the refused card');
});
