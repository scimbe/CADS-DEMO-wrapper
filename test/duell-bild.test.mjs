// KI-Bilder auf Wunsch (lib/duell-bild.mjs): deadline and "busy", limits, price and refund, refusals of the sentence, the
// picture check fail-closed, reports hide a picture, retention. No GPU, no model, no network: backend and model are stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createCredit } from '../lib/duell-credit.mjs';
import { createReports } from '../lib/duell-report.mjs';
import { createBild, checkPrompt, checkVerdict, stubPng, makeBackend, promptOf, SAFE_SUFFIX } from '../lib/duell-bild.mjs';
import { createLlm } from '../lib/duell-llm.mjs';

const MAIL = 'lea@example.org';
const keyOf = (mail) => 'a' + createHash('sha256').update(mail).digest('hex').slice(0, 24);
const OK_MOD = { json: { risk: 0, cats: [], drink: 'none' }, usage: {} };
const OK_PIC = { json: { ok: true, cats: [] }, usage: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** llm: answers by schema name; mod/pic may be an object, a function or 'throw' / 'hang'. */
function fakeLlm({ mod = OK_MOD, pic = OK_PIC } = {}) {
  const calls = [];
  return {
    calls,
    async generate(req) {
      calls.push(req);
      const a = req.name === 'bild_check' ? pic : mod;
      if (a === 'throw') { const e = new Error('budget'); e.code = 'budget'; throw e; }
      if (a === 'hang') return new Promise(() => {});
      return typeof a === 'function' ? a(req) : a;
    },
  };
}
function fakeBackend({ ms = 20, flagged = false, hang = false } = {}) {
  const calls = [];
  return { kind: 'stub', calls, async generate(q) { calls.push(q); if (hang) return new Promise(() => {}); await sleep(ms); return { buf: flagged ? null : stubPng(8, 8, q.seed), mime: 'image/png', ms, flagged }; } };
}
function setup({ env = {}, llm = fakeLlm(), backend = fakeBackend(), credits = 0, now, age16 = () => true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'duell-bild-'));
  const lines = [], log = (o) => lines.push(o);
  const d = createDuell({ env: { DUELL_SEAL_SECRET: 'seal' }, salt: 's', log, llm: async () => '{}' });
  const credit = createCredit({ env: {}, log, file: join(dir, 'credit.json') });
  if (credits) credit.grant(keyOf(MAIL), credits, 'voucher', 'abcdef12');
  const strikes = [];
  const mod = { canCreate: () => ({ ok: true }), strike: (...a) => strikes.push(a) };
  Object.assign(d.shared, { credit, mod, age16 });
  const who = async (req) => { const m = req && req.headers && req.headers['x-mail']; return m ? { account: true, acct: keyOf(m), mail: m } : { account: false }; };
  const b = createBild({ env: { DUELL_BILD_DIR: join(dir, 'bild'), DUELL_BILD_EST_CARD_MS: '50', DUELL_BILD_EST_LOGO_MS: '50', DUELL_BILD_EST_AVATAR_MS: '50', DUELL_BILD_CHECK_MS: '400', DUELL_BILD_PROMPT_MS: '200', DUELL_ADMIN_TOKEN: 'admin-token-123456', ...env }, shared: d.shared, who, llm, backend, log, ...(now ? { now } : {}) });
  const reports = createReports({ env: { DUELL_REPORT_DIR: join(dir, 'rep'), DUELL_ADMIN_TOKEN: 'admin-token-123456' }, shared: d.shared, onBild: b, log });
  return { b, d, credit, strikes, reports, dir, lines, llm, backend };
}
async function serve(s) {
  const srv = http.createServer(async (q, r) => {
    const url = new URL(q.url, 'http://x');
    if (!(await s.b.route(q, r, url)) && !(await s.reports.route(q, r, url))) r.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (path, body, mail = MAIL) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(mail ? { 'x-mail': mail } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const done = async (job, mail) => { for (let i = 0; i < 200; i++) { const r = await post('/api/duell/bild/job', { job }, mail); if (r.body.state === 'done' || r.body.state === 'failed') return r.body; await sleep(15); } throw new Error('never done'); };
  return { base, post, done, get: (p, h = {}) => fetch(base + p, { headers: h }), close: () => new Promise((r) => srv.close(r)) };
}
const P = (use = 'card', text = 'ein Drache, der auf dem Mond Pfannkuchen backt', style = 'comic') => ({ use, text, style, lang: 'de' });

test('aus ohne Backend; Login noetig; Status sagt, was geht und warum nicht', async () => {
  const off = createBild({ env: {}, shared: createDuell({ env: {}, salt: 's', log: () => {} }).shared, who: async () => ({ account: true, acct: 'aXXXXXXXXXX' }), llm: fakeLlm(), log: () => {} });
  assert.equal(off.on(), false);
  assert.equal((await off.ask({ account: true, acct: 'aXXXXXXXXXX', mail: MAIL }, P())).body.error, 'off');
  const s = setup(), h = await serve(s);
  try {
    assert.equal((await h.post('/api/duell/bild', P(), null)).status, 401);
    const st = await h.post('/api/duell/bild/status', {});
    assert.equal(st.body.on, true);
    assert.deepEqual(st.body.can, { card: true, logo: true, avatar: false });
    assert.equal(st.body.why.avatar, 'credit');
    assert.equal(st.body.deadlineS, 30);
  } finally { await h.close(); }
});

test('ein Bild: angenommen, erzeugt, geprueft, ausgeliefert mit Siegel; kostenlos aus dem Bildtopf', async () => {
  const s = setup(), h = await serve(s);
  try {
    const a = await h.post('/api/duell/bild', P());
    assert.equal(a.status, 202);
    assert.equal(a.body.paid, 'free');
    assert.ok(['queued', 'generating'].includes(a.body.state));
    const r = await h.done(a.body.job);
    assert.equal(r.state, 'done');
    assert.match(r.url, /^\/duell\/bild\/[A-Za-z0-9_-]{22}\.png$/);
    const img = await h.get(r.url);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-robots-tag'), 'noindex');
    assert.equal(s.d.shared.sealer.verify(r.seal, { bild: r.id }).valid, true);
    // the worker got the fixed safety words and the size of a card; the check saw the picture
    assert.ok(s.backend.calls[0].prompt.endsWith(SAFE_SUFFIX));
    assert.deepEqual([s.backend.calls[0].width, s.backend.calls[0].height], [512, 768]);
    const check = s.llm.calls.find((c) => c.name === 'bild_check');
    assert.equal(check.images.length, 1);
    assert.equal(check.images[0].mediaType, 'image/png');
    assert.equal((await h.post('/api/duell/bild/status', {})).body.free.left, 2);
    // another account cannot poll the job; nothing lists pictures
    assert.equal((await h.post('/api/duell/bild/job', { job: a.body.job }, 'max@example.org')).status, 404);
    assert.equal((await h.get('/duell/bild/')).status, 404);
  } finally { await h.close(); }
});

test('30 s: eine volle Schlange antwortet sofort "busy" mit ehrlicher Wartezeit und kostet nichts', async () => {
  const s = setup({ env: { DUELL_BILD_EST_CARD_MS: '16000' }, backend: fakeBackend({ ms: 300 }) }), h = await serve(s);
  try {
    const a = await h.post('/api/duell/bild', P());
    assert.equal(a.status, 202);
    const t = Date.now(), b = await h.post('/api/duell/bild', P('card', 'eine Katze auf dem Fahrrad'), 'max@example.org');
    assert.ok(Date.now() - t < 1000, 'answered at once');
    assert.equal(b.status, 429);
    assert.equal(b.body.error, 'busy');
    assert.equal(b.body.position, 2);
    assert.ok(b.body.etaS >= 16 && b.body.retryS >= 5);
    assert.equal((await h.post('/api/duell/bild/status', {}, 'max@example.org')).body.free.left, 3, 'nothing charged');
  } finally { await h.close(); }
});

test('harte Frist: ein haengender Worker endet als timeout innerhalb der Frist, das Bild wird erstattet', async () => {
  const s = setup({ env: { DUELL_BILD_DEADLINE_MS: '1200', DUELL_BILD_CHECK_MS: '300' }, backend: fakeBackend({ hang: true }) }), h = await serve(s);
  try {
    const t = Date.now(), a = await h.post('/api/duell/bild', P());
    const r = await h.done(a.body.job);
    assert.ok(Date.now() - t < 1500, 'within the deadline');
    assert.deepEqual([r.state, r.error, r.charged], ['failed', 'timeout', false]);
    assert.equal((await h.post('/api/duell/bild/status', {})).body.free.left, 3);
  } finally { await h.close(); }
});

test('Frist laeuft auch ueber die Bildpruefung: haengt sie, kein Bild (fail closed), erstattet', async () => {
  const s = setup({ env: { DUELL_BILD_DEADLINE_MS: '1000', DUELL_BILD_CHECK_MS: '300' }, llm: fakeLlm({ pic: 'hang' }) }), h = await serve(s);
  try {
    const r = await h.done((await h.post('/api/duell/bild', P())).body.job);
    assert.equal(r.state, 'failed');
    assert.equal(r.error, 'timeout');
    assert.equal(r.charged, false);
    assert.equal(r.url, undefined);
  } finally { await h.close(); }
});

test('Bildpruefung fail closed: nicht ok, Fehler, kaputtes JSON -> kein Bild, keine Datei, erstattet, kein Strike', async () => {
  for (const [pic, err] of [[{ json: { ok: false, cats: ['nudity'] } }, 'unsafe'], ['throw', 'check-failed'], [{ json: null }, 'unsafe'], [{ json: { ok: true, cats: ['gore'] } }, 'unsafe']]) {
    const s = setup({ llm: fakeLlm({ pic }) }), h = await serve(s);
    try {
      const r = await h.done((await h.post('/api/duell/bild', P())).body.job);
      assert.equal(r.state, 'failed'); assert.equal(r.error, err); assert.equal(r.charged, false);
      assert.equal(Object.keys(s.b._idx.pics).length, 0, 'nothing stored');
      assert.equal((await h.post('/api/duell/bild/status', {})).body.free.left, 3);
      assert.equal((await h.post('/api/duell/bild', P())).status, 202, 'no strike, no pause');
    } finally { await h.close(); }
  }
  assert.equal(checkVerdict({ json: { ok: true, cats: [] } }), true);
  assert.equal(checkVerdict({ json: { ok: 'yes', cats: [] } }), false);
  // the worker's own classifier flagged it: refused too
  const s = setup({ backend: fakeBackend({ flagged: true }) }), h = await serve(s);
  try { const r = await h.done((await h.post('/api/duell/bild', P())).body.job); assert.equal(r.error, 'unsafe'); assert.equal(r.charged, false); } finally { await h.close(); }
});

test('Preis: Bildtopf, dann Guthaben; Kontobild nur mit Guthaben; Fehler kostet kein Guthaben', async () => {
  const s = setup({ env: { DUELL_BILD_FREE: '1' } }), h = await serve(s);
  try {
    assert.equal((await h.done((await h.post('/api/duell/bild', P('logo', 'ein Fuchs als Wappen'))).body.job)).state, 'done');
    const q = await h.post('/api/duell/bild', P());
    assert.deepEqual([q.status, q.body.error], [402, 'quota']);
    const av = await h.post('/api/duell/bild', P('avatar', 'ein Pinguin mit Muetze'));
    assert.deepEqual([av.status, av.body.error, av.body.why], [402, 'credit', 'avatar-needs-credit']);
    s.credit.grant(keyOf(MAIL), 2, 'voucher', 'abcdef12');
    const c = await h.post('/api/duell/bild', P('avatar', 'ein Pinguin mit Muetze'));
    assert.equal(c.body.paid, 'credit');
    assert.equal(s.credit.available(keyOf(MAIL)), 1, 'held while making');
    const r = await h.done(c.body.job);
    assert.equal(r.charged, 'credit');
    assert.equal(s.credit.view(keyOf(MAIL)).balance, 1, 'charged on delivery');
    const set = await h.post('/api/duell/bild/avatar', { id: r.id });
    assert.equal(set.body.avatar, r.url);
    assert.equal((await h.post('/api/duell/bild/status', {})).body.avatar, r.url);
    // another account's picture is never the own account picture
    assert.equal((await h.post('/api/duell/bild/avatar', { id: r.id }, 'max@example.org')).status, 404);
  } finally { await h.close(); }
  const s2 = setup({ env: { DUELL_BILD_FREE: '0' }, credits: 1, llm: fakeLlm({ pic: 'throw' }) }), h2 = await serve(s2);
  try {
    const r = await h2.done((await h2.post('/api/duell/bild', P())).body.job);
    assert.equal(r.charged, false);
    assert.equal(s2.credit.available(keyOf(MAIL)), 1, 'nothing charged');
  } finally { await h2.close(); }
});

test('Limits: pro Konto und Tag, Abbrechen in der Schlange kostet nichts', async () => {
  const s = setup({ env: { DUELL_BILD_PER_DAY: '2', DUELL_BILD_PARALLEL: '1', DUELL_BILD_DEADLINE_MS: '8000' }, backend: fakeBackend({ ms: 2000 }) }), h = await serve(s);
  try {
    await h.post('/api/duell/bild', P());
    const second = await h.post('/api/duell/bild', P('logo', 'ein Stern'));
    assert.equal(second.body.state, 'queued');
    const c = await h.post('/api/duell/bild/cancel', { job: second.body.job });
    assert.deepEqual(c.body, { cancelled: true, charged: false });
    const third = await h.post('/api/duell/bild', P());
    assert.deepEqual([third.status, third.body.error], [429, 'daily-cap']);
  } finally { await h.close(); }
});

test('Satz-Pruefung: feste Absagen ohne Strike, harte Faelle mit Strike und Pause, Krise mit Hilfe, Modell fail closed', async () => {
  const s = setup({ env: { DUELL_BILD_BLOCKS_PER_DAY: '2' } }), h = await serve(s);
  try {
    for (const [text, reason] of [['Foto von Olaf Scholz', 'real_person'], ['blutiger Zombie im Wald', 'gore'], ['ein Logo wie Nike', 'brand'], ['Sturmgewehr ganz cool', 'weapons']]) {
      const r = await h.post('/api/duell/bild', P('card', text));
      assert.deepEqual([r.status, r.body.error, r.body.reason], [422, 'refused', reason], text);
    }
    const cr = await h.post('/api/duell/bild', P('card', 'ich will mich umbringen'));
    assert.equal(cr.body.why, 'crisis'); assert.ok(cr.body.help);
    assert.equal(s.backend.calls.length, 0, 'no picture for any of them');
    assert.equal(s.llm.calls.length, 0, 'no model call for rules without a model');
    for (let i = 0; i < 2; i++) assert.equal((await h.post('/api/duell/bild', P('card', 'nackte Frau am Strand'))).body.error, 'blocked');
    assert.equal((await h.post('/api/duell/bild', P())).body.error, 'throttled');
  } finally { await h.close(); }
  // the moderation model: a refusal is a fixed text, risk 3 a strike, no answer a closed door (and nothing charged)
  for (const [mod, status, error] of [[{ json: { risk: 2, cats: ['brand'], drink: 'none' } }, 422, 'refused'], [{ json: { risk: 3, cats: ['violence'], drink: 'none' } }, 422, 'blocked'], ['throw', 503, 'check-off'], [{ json: null }, 422, 'refused']]) {
    const s2 = setup({ llm: fakeLlm({ mod }) }), h2 = await serve(s2);
    try {
      const r = await h2.post('/api/duell/bild', P());
      assert.deepEqual([r.status, r.body.error], [status, error]);
      assert.equal((await h2.post('/api/duell/bild/status', {})).body.free.left, 3);
    } finally { await h2.close(); }
  }
});

test('Melden: Siegel geprueft, schwerer Grund versteckt das Bild sofort; Pruefer: dismiss zeigt es wieder, block loescht + Strike', async () => {
  const s = setup(), h = await serve(s);
  try {
    const r = await h.done((await h.post('/api/duell/bild', P())).body.job);
    const bad = await h.post('/api/duell/report', { reason: 'sex', kind: 'bild', seal: r.seal, option: { bild: 'x'.repeat(22) } }, null);
    assert.equal(bad.status, 202);
    assert.equal((await h.get(r.url)).status, 200, 'a seal for another id holds nothing');
    const rep = await h.post('/api/duell/report', { reason: 'sex', kind: 'bild', seal: r.seal, option: { bild: r.id }, consent: true, content: { bild: r.id } }, null);
    assert.equal(rep.status, 202);
    assert.equal((await h.get(r.url)).status, 404, 'held for everyone');
    const adm = { authorization: 'Bearer admin-token-123456' };
    assert.equal((await h.get('/api/duell/bild/admin/' + r.id, adm)).status, 200, 'the reviewer still sees it');
    assert.equal((await h.get('/api/duell/bild/admin/' + r.id)).status, 401);
    const open = await (await h.get('/api/duell/report', adm)).json();
    const rec = open.open.find((x) => x.bild === r.id);
    assert.ok(rec && rec.kind === 'bild' && rec.sealOk);
    const dec = async (id, action) => (await fetch(h.base + '/api/duell/report/' + id, { method: 'POST', headers: { ...adm, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })).status;
    assert.equal(await dec(rec.id, 'dismiss'), 200);
    assert.equal((await h.get(r.url)).status, 200, 'shown again');
    // "other" needs several reporters; then a human blocks
    for (let i = 0; i < 3; i++) await h.post('/api/duell/report', { reason: 'other', kind: 'bild', seal: r.seal, option: { bild: r.id } }, null);
    assert.equal((await h.get(r.url)).status, 404);
    const rec2 = (await (await h.get('/api/duell/report', adm)).json()).open.find((x) => x.bild === r.id);
    assert.equal(await dec(rec2.id, 'block'), 200);
    assert.equal(s.b._idx.pics[r.id].st, 'gone');
    assert.equal(existsSync(join(s.dir, 'bild', r.id + '.png')), false, 'file deleted');
    assert.equal(s.strikes.length, 1); assert.equal(s.strikes[0][0], keyOf(MAIL)); assert.equal(s.strikes[0][1], 'confirmed');
    // the recipient of a link has only the id: a known id is enough, an unknown one holds nothing and does not fail
    const r2 = await h.done((await h.post('/api/duell/bild', P('logo', 'ein Stern'))).body.job);
    assert.equal((await h.post('/api/duell/report', { reason: 'hate', kind: 'bild', consent: true, content: { bild: r2.id } }, null)).status, 202);
    assert.equal((await h.get(r2.url)).status, 404, 'held without a seal');
    assert.equal((await h.post('/api/duell/report', { reason: 'hate', kind: 'bild', consent: true, content: { bild: 'y'.repeat(22) } }, null)).status, 202);
  } finally { await h.close(); }
});

test('Aufbewahrung: 30 Tage, gespeicherte 365, dann weg', async () => {
  const clock = { t: Date.now() };
  const s = setup({ now: () => clock.t }), h = await serve(s);
  try {
    const a = await h.done((await h.post('/api/duell/bild', P())).body.job);
    const b = await h.done((await h.post('/api/duell/bild', P('logo', 'ein Stern'))).body.job);
    assert.equal((await h.post('/api/duell/bild/keep', { id: b.id })).body.kept, true);
    assert.equal((await h.post('/api/duell/bild/keep', { id: b.id }, 'max@example.org')).status, 404, 'only the owner keeps');
    clock.t += 31 * 86400000;
    s.b.expire();
    assert.equal((await h.get(a.url)).status, 404);
    assert.equal(existsSync(join(s.dir, 'bild', a.id + '.png')), false);
    assert.equal((await h.get(b.url)).status, 200);
    clock.t += 340 * 86400000;
    s.b.expire();
    assert.equal((await h.get(b.url)).status, 404);
  } finally { await h.close(); }
});

test('Konfiguration: Stub-Pruefung nie mit echtem Worker; Worker ohne Token ist aus', () => {
  const sh = createDuell({ env: {}, salt: 's', log: () => {} }).shared;
  const b = createBild({ env: { DUELL_BILD_BACKEND: 'http', DUELL_BILD_URL: 'http://gpu:8080', DUELL_BILD_TOKEN: 'x'.repeat(20), DUELL_BILD_CHECK: 'stub', DUELL_BILD_DIR: mkdtempSync(join(tmpdir(), 'b-')) }, shared: sh, who: async () => ({}), llm: fakeLlm(), log: () => {} });
  assert.equal(b.on(), false);
  assert.equal(makeBackend({ DUELL_BILD_BACKEND: 'http', DUELL_BILD_URL: 'http://gpu:8080' }).kind, 'off');
  assert.equal(createBild({ env: { DUELL_BILD_DEADLINE_MS: '90000' }, shared: sh, who: async () => ({}), log: () => {} }).cfg.deadlineMs, 30000, 'never more than 30 s');
  assert.match(promptOf('ein "Hund"\nmit Hut', 'logo', 'pixel'), /^16-bit pixel art, .*simple flat emblem logo.*: "ein Hund mit Hut"\. family friendly/);
});

test('HTTP-Worker: Token, Frist an den Worker, nur echte JPEG/PNG-Bytes', async () => {
  const seen = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const fetchImpl = async (url, o) => { seen.push({ url, o }); return { ok: true, json: async () => ({ image: jpeg.toString('base64'), ms: 1800 }) }; };
  const be = makeBackend({ DUELL_BILD_BACKEND: 'http', DUELL_BILD_URL: 'http://gpu:8080/', DUELL_BILD_TOKEN: 't'.repeat(20) }, { fetchImpl });
  const g = await be.generate({ prompt: 'p', width: 256, height: 256, steps: 4, seed: 1 }, 5000);
  assert.equal(g.mime, 'image/jpeg');
  assert.equal(seen[0].url, 'http://gpu:8080/generate');
  assert.equal(seen[0].o.headers.authorization, 'Bearer ' + 't'.repeat(20));
  assert.equal(JSON.parse(seen[0].o.body).timeout_ms, 5000);
  const bad = makeBackend({ DUELL_BILD_BACKEND: 'http', DUELL_BILD_URL: 'http://gpu:8080', DUELL_BILD_TOKEN: 't'.repeat(20) }, { fetchImpl: async () => ({ ok: true, json: async () => ({ image: Buffer.from('<svg/>').toString('base64') }) }) });
  await assert.rejects(bad.generate({ prompt: 'p', width: 8, height: 8, steps: 4, seed: 1 }, 1000), /worker-bad-image/);
});

test('Modellschicht: Bilder nur an Anthropic als image-Block, sonst no-vision (fail closed)', async () => {
  const bodies = [];
  const fetchImpl = async (url, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"ok":true,"cats":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 10 } }) }; };
  const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_USD: '1' }, fetchImpl, log: () => {} });
  const data = stubPng(4, 4, 1).toString('base64');
  const r = await llm.generate({ system: [{ text: 'x', cache: true }], user: 'u', images: [{ mediaType: 'image/png', data }], schema: { type: 'object' }, name: 'bild_check', maxTokens: 50 });
  assert.equal(r.json.ok, true);
  assert.deepEqual(bodies[0].messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
  assert.deepEqual(bodies[0].messages[0].content[1], { type: 'text', text: 'u' });
  await assert.rejects(llm.generate({ system: 'x', user: 'u', images: [{ mediaType: 'image/gif', data }] }), /bad-image/);
  const local = createLlm({ env: { DUELL_CARD_PROVIDER: 'ollama', DUELL_OLLAMA_BASE_URL: 'http://o' }, fetchImpl, log: () => {} });
  await assert.rejects(local.generate({ system: 'x', user: 'u', images: [{ mediaType: 'image/png', data }] }), /no-vision/);
  // a text call stays a plain string, as before
  await llm.generate({ system: 'x', user: 'plain' });
  assert.equal(bodies[1].messages[0].content, 'plain');
});

test('Regeln ohne Modell: harmlose Wuensche gehen durch', () => {
  for (const t of ['ein Drache, der auf dem Mond Pfannkuchen backt', 'Ritter mit Schwert vor der Burg', 'Katze mit Sonnenbrille', 'Fussballteam Logo mit Adler', 'Aquarell vom Hafen bei Sonnenuntergang', 'a robot watering flowers']) assert.deepEqual(checkPrompt(t), { ok: true }, t);
  for (const t of ['Kinder im Bett kuessen', 'topless am Pool', 'SS-Runen auf der Jacke', 'Portrait von Angela Merkel']) assert.equal(checkPrompt(t).ok, false, t);
});
