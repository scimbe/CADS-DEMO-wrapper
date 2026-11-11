// KI-Bilder, price (lib/duell-bild.mjs, approved 11.11.): 3 free pictures per account and calendar month (UTC), then 1 credit
// (lib/duell-credit.mjs). Charged only when a checked picture is delivered; reserved while it is made, so requests at the
// same time never spend one unit twice; refused, busy, failed, timeout and cancel cost nothing. /api/duell/ai/status shows
// bild.freeLeft. No GPU, no model, no network: backend and model are stubs; the clock is set by the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { createCredit } from '../lib/duell-credit.mjs';
import { createBild, stubPng } from '../lib/duell-bild.mjs';

const MAIL = 'lea@example.org';
const OK_MOD = { json: { risk: 0, cats: [], drink: 'none' }, usage: {} };
const OK_PIC = { json: { ok: true, cats: [] }, usage: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The model: the sentence check waits modMs (so requests at once really interleave), the picture check answers `pic`. */
function fakeLlm({ pic = OK_PIC, modMs = 0, mod = OK_MOD } = {}) {
  return {
    async generate(req) {
      if (req.name === 'bild_check') { if (pic === 'throw') throw new Error('budget'); return pic; }
      if (modMs) await sleep(modMs);
      return mod;
    },
  };
}
function fakeBackend({ ms = 20, fail = false, flagged = false, hang = false, onGenerate } = {}) {
  return {
    kind: 'stub',
    async generate(q) {
      if (onGenerate) onGenerate(q);
      if (hang) return new Promise(() => {});
      await sleep(ms);
      if (fail) throw new Error('worker-http-500');
      return { buf: flagged ? null : stubPng(8, 8, q.seed), mime: 'image/png', ms, flagged };
    },
  };
}
function setup({ env = {}, llm = fakeLlm(), backend = fakeBackend(), credits = 0, clock = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'duell-bild-preis-'));
  const lines = [], log = (o) => lines.push(o);
  const now = clock ? () => clock.t : Date.now;
  const d = createDuell({ env: { DUELL_SEAL_SECRET: 'seal' }, salt: 's', log, llm: async () => '{}', now });
  d.shared.age16 = () => true;
  const auth = { mode: 'gate', identify: async (req) => ({ email: (req && req.headers && req.headers['x-mail']) || null }) };
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: async () => '{}', shared: d.shared, auth, log, now });
  const credit = createCredit({ env: {}, now, log, file: join(dir, 'credit.json') });
  const mod = { canCreate: () => ({ ok: true }), strike: () => {} };
  Object.assign(d.shared, { credit, mod });
  const b = createBild({
    env: { DUELL_BILD_DIR: join(dir, 'bild'), DUELL_BILD_EST_CARD_MS: '50', DUELL_BILD_EST_LOGO_MS: '50', DUELL_BILD_EST_AVATAR_MS: '50', DUELL_BILD_CHECK_MS: '400', DUELL_BILD_PROMPT_MS: '500', DUELL_BILD_PER_DAY: '50', DUELL_BILD_QUEUE_MAX: '50', DUELL_BILD_PARALLEL: '8', ...env },
    shared: d.shared, who: ai.who, llm, backend, log, now,
  });
  d.shared.bild = b;   // as server.mjs: /api/duell/ai/status answers "bild"
  return { b, d, ai, credit, lines, dir, clock };
}
async function serve(s) {
  const srv = http.createServer(async (q, r) => {
    const url = new URL(q.url, 'http://x');
    if (!(await s.b.route(q, r, url)) && !(await s.ai.route(q, r, url))) r.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (path, body, mail = MAIL) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(mail ? { 'x-mail': mail } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const done = async (job) => { for (let i = 0; i < 300; i++) { const r = await post('/api/duell/bild/job', { job }); if (r.body.state === 'done' || r.body.state === 'failed') return r.body; await sleep(15); } throw new Error('never done'); };
  const make = async (p) => { const a = await post('/api/duell/bild', p); return a.status === 202 ? { a, r: await done(a.body.job) } : { a, r: null }; };
  return { post, done, make, close: () => new Promise((r) => srv.close(r)) };
}
const P = (use = 'card', text = 'ein Drache, der auf dem Mond Pfannkuchen backt') => ({ use, text, style: 'comic', lang: 'de' });
const acctOf = async (s, mail = MAIL) => (await s.ai.who({ headers: { 'x-mail': mail } }, {})).acct;
const bal = async (s) => s.credit.view(await acctOf(s)).balance;
const status = async (h) => (await h.post('/api/duell/bild/status', {})).body;

test('3 kostenlos im Monat, dann 1 Guthaben je Bild; /ai/status zeigt bild.freeLeft; ohne beides 402 mit resetAt', async () => {
  const clock = { t: Date.UTC(2026, 10, 11, 9) };
  const s = setup({ credits: 0, clock }), h = await serve(s);
  s.credit.grant(await acctOf(s), 2, 'voucher', 'abcdef12');
  try {
    let ai = (await h.post('/api/duell/ai/status', {})).body;
    assert.deepEqual(ai.bild, { freeLeft: 3, freeSize: 3, period: 'month', tz: 'UTC', resetAt: '2026-12-01T00:00:00.000Z', credit: 2, price: 1, next: { card: 'free', logo: 'free', avatar: 'credit' } });
    assert.equal((await h.post('/api/duell/ai/status', {}, null)).body.bild, undefined, 'no login, no bild');
    for (const left of [2, 1, 0]) {
      const { a, r } = await h.make(P());
      assert.deepEqual([a.status, a.body.paid, r.state, r.charged], [202, 'free', 'done', 'free']);
      assert.equal((await status(h)).free.left, left);
      assert.equal(await bal(s), 2, 'free pictures never touch the credit');
    }
    ai = (await h.post('/api/duell/ai/status', {})).body;
    assert.equal(ai.bild.freeLeft, 0);
    assert.deepEqual(ai.bild.next, { card: 'credit', logo: 'credit', avatar: 'credit' });
    for (const left of [1, 0]) {
      const { a, r } = await h.make(P('logo', 'ein Fuchs als Wappen'));
      assert.deepEqual([a.body.paid, r.state, r.charged], ['credit', 'done', 'credit']);
      assert.equal(await bal(s), left);
    }
    const no = await h.post('/api/duell/bild', P());
    assert.deepEqual([no.status, no.body.error, no.body.resetAt], [402, 'quota', '2026-12-01T00:00:00.000Z']);
    const st = await status(h);
    assert.deepEqual([st.can.card, st.why.card, st.next.card, st.free.resetAt], [false, 'quota', 'none', '2026-12-01T00:00:00.000Z']);
    assert.equal(s.b._idx.free[await acctOf(s)].n, 3);
  } finally { await h.close(); }
});

test('kein Abzug bei Absage, busy, Worker-Fehler, Frist, Bildpruefung, Abbruch: Bildtopf und Guthaben bleiben', async () => {
  const cases = [
    ['Satz-Regel (ohne Modell)', {}, P('card', 'ein nackter Mann am Strand'), 422],
    ['Satz-Modell lehnt ab', { llm: fakeLlm({ mod: { json: { risk: 2, cats: ['violence'], drink: 'none' }, usage: {} } }) }, P(), 422],
    ['Satz-Modell nicht erreichbar', { llm: { async generate(q) { if (q.name !== 'bild_check') throw new Error('budget'); return OK_PIC; } } }, P(), 503],
    ['busy', { env: { DUELL_BILD_EST_CARD_MS: '40000' } }, P(), 429],
    ['Worker-Fehler', { backend: fakeBackend({ fail: true }) }, P(), 'worker'],
    ['Worker markiert', { backend: fakeBackend({ flagged: true }) }, P(), 'unsafe'],
    ['Bildpruefung lehnt ab', { llm: fakeLlm({ pic: { json: { ok: false, cats: ['gore'] }, usage: {} } }) }, P(), 'unsafe'],
    ['Bildpruefung Fehler', { llm: fakeLlm({ pic: 'throw' }) }, P(), 'check-failed'],
    ['Frist', { env: { DUELL_BILD_DEADLINE_MS: '1000', DUELL_BILD_CHECK_MS: '300' }, backend: fakeBackend({ hang: true }) }, P(), 'timeout'],
  ];
  for (const free of ['3', '0']) {
    for (const [name, opt, p, want] of cases) {
      const s = setup({ ...opt, env: { DUELL_BILD_FREE: free, ...(opt.env || {}) } }), h = await serve(s);
      s.credit.grant(await acctOf(s), 1, 'voucher', 'abcdef12');
      try {
        const a = await h.post('/api/duell/bild', p);
        if (typeof want === 'number') assert.equal(a.status, want, `${name}: ${JSON.stringify(a.body)}`);
        else {
          assert.equal(a.status, 202, name);
          const r = await h.done(a.body.job);
          assert.deepEqual([r.state, r.error, r.charged, r.url], ['failed', want, false, undefined], name);
        }
        const st = await status(h);
        assert.equal(st.free.left, Number(free), `${name} (free ${free}): free pot untouched`);
        assert.equal(await bal(s), 1, `${name} (free ${free}): credit untouched`);
        assert.equal(s.b._idx.free[await acctOf(s)], undefined, `${name}: nothing counted`);
        assert.equal(s.credit.view(await acctOf(s)).held, 0, `${name}: no hold left behind`);
      } finally { await h.close(); }
    }
  }
});

test('Abbruch kostet nichts: in der Schlange und auch waehrend das Bild entsteht', async () => {
  const s = setup({ env: { DUELL_BILD_FREE: '0', DUELL_BILD_PARALLEL: '1', DUELL_BILD_DEADLINE_MS: '8000' }, backend: fakeBackend({ ms: 600 }) }), h = await serve(s);
  s.credit.grant(await acctOf(s), 2, 'voucher', 'abcdef12');
  try {
    const first = await h.post('/api/duell/bild', P());
    const second = await h.post('/api/duell/bild', P('logo', 'ein Stern'));
    assert.equal(second.body.state, 'queued');
    assert.equal(await bal(s), 0, 'both held while in line and making');
    assert.deepEqual((await h.post('/api/duell/bild/cancel', { job: second.body.job })).body, { cancelled: true, charged: false });
    await sleep(100);
    assert.equal((await h.post('/api/duell/bild/job', { job: first.body.job })).body.state, 'generating');
    assert.deepEqual((await h.post('/api/duell/bild/cancel', { job: first.body.job })).body, { cancelled: true, charged: false });
    await sleep(800);   // the worker finishes; the result is dropped, never delivered
    const r = await h.done(first.body.job);
    assert.deepEqual([r.state, r.error, r.charged], ['failed', 'cancelled', false]);
    assert.equal(await bal(s), 2);
    assert.equal(Object.keys(s.b._idx.pics).length, 0, 'nothing stored');
  } finally { await h.close(); }
});

test('zu wenig Guthaben: 402 ohne Modellaufruf; Kontobild nie aus dem Bildtopf', async () => {
  let calls = 0;
  const llm = { async generate(q) { calls++; return q.name === 'bild_check' ? OK_PIC : OK_MOD; } };
  const s = setup({ env: { DUELL_BILD_FREE: '0' }, llm }), h = await serve(s);
  try {
    const q = await h.post('/api/duell/bild', P());
    assert.deepEqual([q.status, q.body.error, q.body.credit, q.body.free], [402, 'quota', 0, 0]);
    const av = await h.post('/api/duell/bild', P('avatar', 'ein Pinguin mit Muetze'));
    assert.deepEqual([av.status, av.body.error, av.body.why], [402, 'credit', 'avatar-needs-credit']);
    assert.equal(calls, 0, 'no model call for a request that cannot be paid');
  } finally { await h.close(); }
  const s2 = setup(), h2 = await serve(s2);   // free pictures left, no credit: the account picture still needs credit
  try {
    const av = await h2.post('/api/duell/bild', P('avatar', 'ein Pinguin mit Muetze'));
    assert.deepEqual([av.status, av.body.error], [402, 'credit']);
    assert.equal((await status(h2)).free.left, 3);
  } finally { await h2.close(); }
});

test('Monatswechsel in UTC: am 1. um 00:00 UTC wieder 3; ein Bild vom 30. zaehlt fuer den alten Monat', async () => {
  const clock = { t: Date.UTC(2026, 10, 30, 23, 0, 0) };
  let jump = null;
  const s = setup({ clock, backend: fakeBackend({ onGenerate: () => { if (jump) { clock.t = jump; jump = null; } } }) }), h = await serve(s);
  try {
    for (let i = 0; i < 2; i++) assert.equal((await h.make(P())).r.charged, 'free');
    // requested 23:59:59 UTC on 30.11., delivered after midnight: a picture of November
    clock.t = Date.UTC(2026, 10, 30, 23, 59, 59); jump = Date.UTC(2026, 11, 1, 0, 0, 1);
    const late = await h.make(P());
    assert.equal(late.r.charged, 'free');
    assert.equal(new Date(clock.t).toISOString(), '2026-12-01T00:00:01.000Z');
    let st = await status(h);
    assert.deepEqual([st.free.left, st.free.resetAt], [3, '2027-01-01T00:00:00.000Z'], 'December starts full');
    assert.deepEqual(s.b._idx.free[await acctOf(s)], { m: '2026-11', n: 3 });
    // one second before midnight the pot was empty; the new month counts on its own
    assert.equal((await h.make(P())).r.charged, 'free');
    assert.deepEqual(s.b._idx.free[await acctOf(s)], { m: '2026-12', n: 1 });
    // year end: 31.12. 23:59 UTC -> resets 01.01.2027; Berlin's midnight (23:00 UTC) is not the boundary
    clock.t = Date.UTC(2026, 11, 31, 23, 30);
    st = await status(h);
    assert.deepEqual([st.free.left, st.free.resetAt, st.free.tz], [2, '2027-01-01T00:00:00.000Z', 'UTC']);
    clock.t = Date.UTC(2027, 0, 1, 0, 0, 0);
    assert.equal((await status(h)).free.left, 3);
  } finally { await h.close(); }
});

test('gleichzeitig: 8 Anfragen auf 3 freie + 1 Guthaben -> genau 4 Bilder, nie doppelt abgebucht', async () => {
  const s = setup({ llm: fakeLlm({ modMs: 40 }) }), h = await serve(s);
  const acct = await acctOf(s);
  s.credit.grant(acct, 1, 'voucher', 'abcdef12');
  try {
    const texts = ['ein Drache', 'eine Katze', 'ein Stern', 'ein Baum', 'ein Haus', 'ein Boot', 'ein Mond', 'ein Igel'];
    const all = await Promise.all(texts.map((t) => h.post('/api/duell/bild', P('card', t + ' im Regen'))));
    const ok = all.filter((x) => x.status === 202), no = all.filter((x) => x.status === 402);
    assert.equal(ok.length, 4, JSON.stringify(all.map((x) => x.status)));
    assert.equal(no.length, 4);
    assert.deepEqual(ok.map((x) => x.body.paid).sort(), ['credit', 'free', 'free', 'free']);
    const rs = await Promise.all(ok.map((x) => h.done(x.body.job)));
    assert.deepEqual(rs.map((r) => r.charged).sort(), ['credit', 'free', 'free', 'free']);
    assert.deepEqual(s.b._idx.free[acct].n, 3);
    assert.equal(await bal(s), 0);
    assert.equal(s.credit._book.get(acct).s, 1, 'exactly one unit spent');
  } finally { await h.close(); }
});

test('gleichzeitig ueber Funktionen: ein gehaltenes Guthaben kann die freie Karte nicht ausgeben; frei nach Fehlschlag', async () => {
  const s = setup({ env: { DUELL_BILD_FREE: '0' }, backend: fakeBackend({ ms: 300 }) }), h = await serve(s);
  const acct = await acctOf(s);
  s.credit.grant(acct, 1, 'voucher', 'abcdef12');
  try {
    const a = await h.post('/api/duell/bild', P());
    assert.equal(a.body.paid, 'credit');
    assert.equal(s.credit.spend(acct, 1), false, 'held for the picture: no second use');
    assert.equal(s.credit.available(acct), 0);
    assert.equal((await h.done(a.body.job)).charged, 'credit');
    assert.equal(s.credit._book.get(acct).s, 1);
  } finally { await h.close(); }
  const s2 = setup({ env: { DUELL_BILD_FREE: '0' }, backend: fakeBackend({ ms: 100, fail: true }) }), h2 = await serve(s2);
  const acct2 = await acctOf(s2);
  s2.credit.grant(acct2, 1, 'voucher', 'abcdef12');
  try {
    const a = await h2.post('/api/duell/bild', P());
    assert.equal((await h2.done(a.body.job)).charged, false);
    assert.equal(s2.credit.spend(acct2, 1), true, 'released: the free card can use it');
  } finally { await h2.close(); }
});

test('Guthaben-Halten: commit einmal, release gibt frei, nie mehr als vorhanden', () => {
  const c = createCredit({ env: {}, log: () => {}, file: '' });
  const k = 'aabcdef0123456789';
  c.grant(k, 2, 'voucher', 'abcdef12');
  const h1 = c.hold(k), h2 = c.hold(k);
  assert.ok(h1 && h2 && h1 !== h2);
  assert.equal(c.hold(k), null, 'nothing left to hold');
  assert.equal(c.view(k).balance, 0); assert.equal(c.view(k).held, 2);
  assert.equal(c.commit(h1), true); assert.equal(c.commit(h1), false, 'once');
  assert.equal(c.release(h2), true);
  assert.deepEqual([c.view(k).balance, c.view(k).held, c._book.get(k).s], [1, 0, 1]);
});
