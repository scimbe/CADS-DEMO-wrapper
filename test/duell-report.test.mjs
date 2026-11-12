// Reporting AI content (consent, rate limit, review queue file, link blocking), seal check, reviewer routes, measurement,
// the ticket poll over HTTP and the game config counting in the pots.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { createReports, REASONS } from '../lib/duell-report.mjs';
import { testShortLinks } from './short-helper.mjs';

const DEV = 'a'.repeat(32), ADMIN = 'admin-token-0123456789abcdef';
const GOOD = JSON.stringify({ options: ['Heute bin ich ein Keks', 'Montag, wir muessen reden', 'Frosch im Hals'] });
const CONF = JSON.stringify({ gravity: 2100, flapPower: 500, pipeGap: 100, pipeSpeed: 200, theme: 'night', emoji: '🚀', title: 'Raketenduell' });

function setup({ env = {}, llm } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'duell-report-')), logs = [];
  const log = (o) => logs.push(JSON.stringify(o));
  const fn = llm || (async (s, u) => (u.startsWith('<wish>') ? CONF : GOOD));
  const d = createDuell({ env: { DUELL_SEAL_SECRET: 'seal-secret', DUELL_IP_PER_HOUR: '99', ...env }, salt: 's', log, llm: fn });
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0', ...env }, llm: fn, shared: d.shared, log });
  const short = testShortLinks({ env: { SHORT_DATA_DIR: join(dir, 'short') }, log: () => {} });
  const rep = createReports({ env: { DUELL_REPORT_DIR: join(dir, 'reports'), DUELL_ADMIN_TOKEN: ADMIN, ...env }, shared: d.shared, blockLink: (id) => short.block(id), log });
  return { d, ai, short, rep, logs, dir };
}
async function serve(s) {
  const srv = http.createServer(async (q, r) => {
    const url = new URL(q.url, 'http://x');
    if (!(await s.ai.route(q, r, url)) && !(await s.rep.route(q, r, url)) && !(await s.d.route(q, r, url)) && !(await s.short.route(q, r, url))) r.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { srv, base, post };
}

test('Melden: Inhalt nur mit Einwilligung, Siegel wird geprueft, Datei ohne IP und Geraet', async () => {
  const s = setup();
  const r = await s.ai.act({ kind: 'line', input: { text: 'Hallo', style: 'neon' }, device: DEV, lang: 'de' }, await s.ai.who(null, DEV), null);
  const content = r.body.options[0], seal = r.body.seals[0];
  const without = s.rep.report({ reason: 'harm', kind: 'line', seal, content }, 'ipA');
  assert.equal(without.status, 202);
  const withC = s.rep.report({ reason: 'harm', kind: 'line', seal, content, consent: true }, 'ipA');
  const forged = s.rep.report({ reason: 'wrong', kind: 'line', seal, content: content + '!', consent: true }, 'ipA');
  const raw = readFileSync(s.rep._file(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(raw[0].content, undefined, 'no consent, no content'); assert.equal(raw[0].sealOk, null);
  assert.equal(raw[1].content, content); assert.equal(raw[1].sealOk, true, 'a genuine AI output');
  assert.equal(raw[2].sealOk, false, 'changed after the AI: the seal does not hold');
  assert.deepEqual(Object.keys(raw[1]).sort(), ['at', 'content', 'id', 'kind', 'link', 'reason', 'seal', 'sealOk', 'state']);
  assert.ok(!JSON.stringify(raw).includes(DEV) && !JSON.stringify(raw).includes('ipA'));
  assert.equal(s.rep.report({ reason: 'evil' }, null).status, 400); assert.deepEqual(s.rep.report({ reason: 'x' }, null).body.reasons, REASONS);
  assert.equal(s.rep.report({ reason: 'other' }, null).status, 400, 'nothing to look at');
  assert.equal(s.rep.report({ reason: 'other', kind: 'line', consent: true, content: 'x'.repeat(17000) }, null).status, 413);
  void withC; void forged;
});

test('Melden: Rate-Limit je gehashter IP und Tagesgrenze; ohne Volume 503', async () => {
  const s = setup({ env: { DUELL_REPORT_PER_HOUR: '2', DUELL_REPORT_DAILY_MAX: '3' } });
  assert.equal(s.rep.report({ reason: 'harm', kind: 'line' }, 'ipA').status, 202);
  assert.equal(s.rep.report({ reason: 'harm', kind: 'line' }, 'ipA').status, 202);
  const r = s.rep.report({ reason: 'harm', kind: 'line' }, 'ipA');
  assert.equal(r.status, 429); assert.ok(Number(r.headers['Retry-After']) > 0);
  assert.equal(s.rep.report({ reason: 'harm', kind: 'line' }, 'ipB').status, 202);
  assert.equal(s.rep.report({ reason: 'harm', kind: 'line' }, 'ipC').body.error, 'daily-limit');
  const off = createReports({ env: {}, shared: setup().d.shared, log: () => {} });
  assert.equal(off.report({ reason: 'harm', kind: 'line' }, null).status, 503);
});

test('Review: nur mit Token; Sperren sperrt den Kurzlink (410 blocked) und loescht den Inhalt aus der Datei', async () => {
  const s = setup(), { srv, base, post } = await serve(s);
  try {
    const link = s.short.create({ f: 'i=karte-1', k: 'card' }, null).body.id;
    const rep = await post('/api/duell/report', { reason: 'hate', kind: 'wish', link, consent: true, content: { x: 'boeser Text' } }, { Origin: 'https://appassets.androidplatform.net' });
    assert.equal(rep.status, 202); assert.equal(rep.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');
    const { id } = await rep.json();
    assert.equal((await fetch(base + '/api/duell/report')).status, 401);
    assert.equal((await fetch(base + '/api/duell/report', { headers: { Authorization: 'Bearer wrong-token-0123456789' } })).status, 401);
    const list = await (await fetch(base + '/api/duell/report', { headers: { Authorization: 'Bearer ' + ADMIN } })).json();
    assert.equal(list.open.length, 1); assert.deepEqual(list.open[0].content, { x: 'boeser Text' });
    const dec = await post('/api/duell/report/' + id, { action: 'block' }, { Authorization: 'Bearer ' + ADMIN });
    assert.deepEqual(await dec.json(), { id, action: 'block', linkBlocked: true });
    assert.equal((await fetch(base + '/api/s/' + link)).status, 410);
    assert.equal((await (await fetch(base + '/api/s/' + link)).json()).error, 'blocked');
    const page = await fetch(base + '/s/' + link);
    assert.equal(page.status, 410); assert.match(await page.text(), /gesperrt/);
    assert.ok(!readFileSync(s.rep._file(), 'utf8').includes('boeser Text'), 'content erased with the decision');
    assert.equal((await post('/api/duell/report/' + id, { action: 'dismiss' }, { Authorization: 'Bearer ' + ADMIN })).status, 409);
    const noAdmin = createReports({ env: { DUELL_REPORT_DIR: join(s.dir, 'r2') }, shared: s.d.shared, log: () => {} });
    const res = { code: 0, writeHead(c) { this.code = c; return this; }, end() {} };
    await noAdmin.route({ method: 'GET', headers: {}, resume() {} }, res, new URL('http://x/api/duell/metrics'));
    assert.equal(res.code, 503, 'without DUELL_ADMIN_TOKEN the reviewer routes are off');
  } finally { srv.close(); }
});

test('Siegel pruefen ueber HTTP; Messung nur kind/outcome/ms; Ticket-Abfrage ueber /api/duell/queue', async () => {
  let open; const wait = new Promise((r) => { open = r; });
  const s = setup({ env: { DUELL_QUEUE_HOLD_MS: '40' }, llm: async (sys, u) => { if (u.includes('warte')) await wait; return u.startsWith('<wish>') ? CONF : GOOD; } });
  const { srv, base, post } = await serve(s);
  try {
    const r = await (await post('/api/duell/ai', { kind: 'line', input: { text: 'Geheimer Satz', style: 'neon' }, device: DEV, lang: 'de' })).json();
    const ok = await (await post('/api/duell/seal', { seal: r.seals[1], content: r.options[1] })).json();
    assert.equal(ok.valid, true); assert.equal(ok.kind, 'line');
    assert.equal((await (await post('/api/duell/seal', { seal: r.seals[1], content: r.options[0] })).json()).valid, false);
    const first = post('/api/duell/ai', { kind: 'line', input: { text: 'warte bitte', style: 'neon' }, device: DEV, lang: 'de' });
    await new Promise((x) => setTimeout(x, 10));
    const q = await post('/api/duell/ai', { kind: 'line', input: { text: 'danach', style: 'neon' }, device: 'b'.repeat(32), lang: 'de', queue: 'ticket' });
    assert.equal(q.status, 202); assert.ok(q.headers.get('retry-after'));
    const qj = await q.json();
    assert.equal(qj.position, 1);
    open(); await first;
    const done = await post('/api/duell/queue', { ticket: qj.ticket });
    assert.equal(done.status, 200);
    const dj = await done.json();
    assert.equal(dj.cost, 1); assert.equal(dj.meter.remaining, 6, 'charged when collected');
    const m = await (await fetch(base + '/api/duell/metrics', { headers: { Authorization: 'Bearer ' + ADMIN } })).json();
    assert.ok(m.rows.some((x) => x.kind === 'line' && x.outcome === 'ok' && x.n === 3));
    assert.ok(m.rows.some((x) => x.kind === 'line' && x.outcome === 'queued'));
    for (const row of m.rows) assert.deepEqual(Object.keys(row).sort(), ['kind', 'msAvg', 'msMax', 'n', 'outcome']);
    assert.equal(m.queue.concurrency, 1);
    const all = s.logs.join('\n');
    assert.ok(!all.includes('Geheimer') && !all.includes(DEV) && !all.includes(qj.ticket), 'no texts, ids or tickets in the log');
  } finally { srv.close(); }
});

test('Spiel-Konfiguration zaehlt mit: mit Geraet im Free-Topf (Cache 0), ohne Geraet nur solange DUELL_CONFIG_ANON an ist', async () => {
  const s = setup();
  const a = await s.d.config({ prompt: 'Rakete im All', device: DEV }, null);
  assert.equal(a.status, 200); assert.equal(a.body.cost, 1); assert.equal(a.body.meter.remaining, 6); assert.match(a.body.receipt, /^r1\.f\./);
  const { seal, meter, cost, receipt, ...conf } = a.body;
  assert.equal(s.d.shared.sealer.verify(seal, conf).valid, true, 'the seal covers exactly the config');
  void meter; void cost; void receipt;
  const b = await s.d.config({ prompt: 'rakete im all', device: DEV }, null);
  assert.equal(b.body.cost, 0); assert.equal(b.body.meter.remaining, 6);
  const anon = await s.d.config({ prompt: 'Unterwasser' }, null);
  assert.equal(anon.status, 200); assert.equal(anon.body.meter, undefined, 'apps before the pots keep working');
  assert.equal((await s.d.config({ prompt: 'x', device: 'kurz' }, null)).status, 400);
  const strict = setup({ env: { DUELL_CONFIG_ANON: '0' } });
  assert.equal((await strict.d.config({ prompt: 'Unterwasser' }, null)).body.error, 'bad-device');
  const m = s.d.shared.metrics.read().rows;
  assert.ok(m.some((x) => x.kind === 'config' && x.outcome === 'ok' && x.n === 2) && m.some((x) => x.kind === 'config' && x.outcome === 'cache'));
});
