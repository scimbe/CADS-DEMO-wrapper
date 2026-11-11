// Code-Modus of the free card (lib/duell-code.mjs, lib/code/store.mjs): a sentence + the genre chip go through the whole
// harness; the person never sends or sees code. The model is a stub here (the real Haiku runs are in the PR's evaluation).
//   - chip G3 -> a signed code card (id.hash.signature only), at most 4 model calls with one repair, counted as one card
//   - broken answers -> repair rounds -> an honest "not this time": no charge, no strike
//   - a refused request, a bad word in the game, no code store, refine with an unknown/pulled base
//   - the code route: JSON with nosniff and its own CSP, 404/409/410, revoke only with the admin token
//   - a report that is blocked pulls the game (signature revoked)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { createReports } from '../lib/duell-report.mjs';
import { MOD_SYSTEM } from '../lib/duell-karte.mjs';
import { CODE_SYSTEM, LIMITS, REFERENCE, codeOf, setCodeLog } from '../lib/duell-code.mjs';

setCodeLog(() => {});
import { createCodeStore, parseLink, codeHash } from '../lib/code/store.mjs';
import { makeKarteKind } from '../lib/duell-karte.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEV = 'd'.repeat(32);
const fence = (s) => '```js\n' + s + '\n```';
function fakeLlm(answers, mod = () => ({ risk: 0, cats: [], drink: 'none' })) {
  const calls = [];
  let i = 0;
  return {
    calls, configured: true,
    async generate(req) {
      calls.push(req);
      if (req.system === MOD_SYSTEM) return { json: mod(req), stop: 'end_turn', usage: { in: 10, out: 8 }, usd: 0.0001 };
      assert.equal(req.system, CODE_SYSTEM);
      const a = answers[Math.min(i++, answers.length - 1)];
      return { json: null, raw: typeof a === 'function' ? a(req) : a, stop: 'end_turn', usage: { in: 40, out: 900 }, usd: 0.001 };
    },
  };
}
function mk(cardLlm, { store = createCodeStore({ env: {}, log: () => {} }) } = {}) {
  const d = createDuell({ env: { DUELL_DAILY_MAX: '200', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: async () => '{}' });
  d.shared.age16 = () => true; d.shared.age18 = () => false;
  if (store) d.shared.code = store;
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: async () => '{}', cardLlm, shared: d.shared, auth: { mode: 'gate', identify: async () => ({ email: 'lea@example.org' }) }, log: () => {} });
  return { d, ai, store };
}
const body = (text, extra = {}) => ({ kind: 'karte', input: { text, art: 'game', genre: 'G3', ...extra }, device: DEV, lang: 'de' });
const run = async (ai, b) => ai.act(b, await ai.who({}, b), null);

test('Chip „Zahlen schieben“ + Satz -> signierte Code-Karte; nur id.hash.signatur, kein Code; höchstens 4 Aufrufe', async () => {
  const llm = fakeLlm([fence(REFERENCE.zahlen)]);
  const { ai, store } = mk(llm);
  const r = await run(ai, body('Ich möchte mit jemandem 2024 spielen'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = r.body.options[0];
  assert.equal(o.art, 'code'); assert.equal(o.doc.k, 'code');
  assert.ok(!JSON.stringify(r.body).includes('const GAME'), 'the answer carries no code');
  const p = parseLink(o.doc.c);
  assert.ok(p, o.doc.c);
  const rec = store.get(p.id);
  assert.equal(rec.h, p.h); assert.equal(rec.sig, p.sig); assert.equal(codeHash(rec.code), p.h);
  assert.ok(store.verify(rec));
  assert.ok((o.ki && o.ki.s) || (r.body.seals && r.body.seals[0]), 'sealed like every free card (deck, report)');
  assert.ok(llm.calls.length <= 4, 'calls: ' + llm.calls.length);
  assert.ok(r.body.cost === 1 || r.body.credit || r.body.receipt, 'counted as one free card');
});

test('kaputte Antwort -> eine Reparaturrunde mit kurzen Gründen (Standard: 4 Aufrufe) -> dann besteht sie', async () => {
  const llm = fakeLlm(['no code here', fence(REFERENCE.zahlen)]);
  const { ai } = mk(llm);
  const r = await run(ai, body('Kacheln zusammenschieben'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const writes = llm.calls.filter((c) => c.system === CODE_SYSTEM);
  assert.equal(writes.length, 2);
  assert.match(writes[1].user, /no ```js block/);
  assert.equal(llm.calls.length, 4, 'request, write, repair, content check');
});

test('mit DUELL_CODE_MAX_CALLS=5 zwei Reparaturrunden; nie mehr als die Grenze', async () => {
  const keep = LIMITS.maxCalls;
  LIMITS.maxCalls = 5;
  try {
    const llm = fakeLlm(['no code here', fence('const GAME = { meta: {} };'), fence(REFERENCE.zahlen)]);
    const { ai } = mk(llm);
    const r = await run(ai, body('Kacheln zusammenschieben'));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const writes = llm.calls.filter((c) => c.system === CODE_SYSTEM);
    assert.equal(writes.length, 3);
    assert.match(writes[2].user, /GAME\.\w+ is missing/);
    assert.equal(llm.calls.length, 5);
  } finally { LIMITS.maxCalls = keep; }
  const llm4 = fakeLlm(['no code here', 'no code', fence(REFERENCE.zahlen)]);
  const r4 = await run(mk(llm4).ai, body('Kacheln zusammenschieben'));
  assert.equal(r4.body.notyet.what, 'code-failed');
  assert.ok(llm4.calls.length <= 4);
});

test('immer kaputt -> ehrliche Absage ohne Abbuchung und ohne Strike', async () => {
  const llm = fakeLlm([fence('while (true) {}')]);
  const { ai } = mk(llm);
  const before = await ai.who({}, body('x'));
  const r = await run(ai, body('zahlen schieben'));
  assert.equal(r.status, 200);
  assert.equal(r.body.notyet.what, 'code-failed');
  assert.deepEqual(r.body.options, []);
  assert.equal(r.body.cost, undefined); assert.equal(r.body.receipt, undefined);
  const again = await run(ai, body('zahlen schieben, nochmal'));
  assert.notEqual(again.status, 403, 'no strike');
  void before;
});

test('abgelehnter Wunsch: S2 wie bei jeder freien Karte, kein Spiel', async () => {
  const llm = fakeLlm([fence(REFERENCE.zahlen)], () => ({ risk: 3, cats: ['hate'], drink: 'none' }));
  const { ai } = mk(llm);
  const r = await run(ai, body('zahlen schieben gegen eine gruppe die ich hasse'));
  assert.equal(r.status, 422); assert.equal(r.body.error, 'blocked');
});

test('ein unerlaubtes Wort im Spiel geht zurück an das Modell; bleibt es, gibt es kein Spiel', async () => {
  const bad = REFERENCE.zahlen.replace("'Geschafft!'", "'Geschafft, du Arschloch!'");
  const llm = fakeLlm([fence(bad)]);
  const { ai } = mk(llm);
  const r = await run(ai, body('zahlen schieben'));
  assert.equal(r.status, 200); assert.equal(r.body.notyet.what, 'code-failed');
  assert.ok(llm.calls.filter((c) => c.system === CODE_SYSTEM).some((c) => /not allowed here/.test(c.user)));
});

test('ohne Code-Store (DUELL_CODE_MODE aus): der Chip ist ehrlich „noch nicht“, nie ein Flugspiel', async () => {
  const llm = fakeLlm([fence(REFERENCE.zahlen)]);
  const { ai } = mk(llm, { store: null });
  const r = await run(ai, body('zahlen schieben'));
  assert.equal(r.status, 200); assert.ok(r.body.notyet); assert.equal(llm.calls.length, 0);
});

test('kein Code vom Client: read() kennt nur Satz, Kategorie, Genre und die id eines signierten Spiels', () => {
  const k = makeKarteKind({ redactContact: (s) => s, hasContact: () => false, text: (s) => s });
  const d = k.read({ text: 'zahlen schieben', art: 'game', genre: 'G3', code: 'const GAME = {}', base: 'A'.repeat(16), meta: { x: 1 } });
  assert.deepEqual(Object.keys(d).sort(), ['age', 'art', 'base', 'genre', 'mark', 'text']);
  assert.equal(k.read({ text: 'x', art: 'game', base: '../../etc' }).base, undefined);
});

test('Verfeinern: die Basis kommt vom Server (nie vom Client), geht durch den ganzen Harness; unbekannt oder zurückgezogen: nein', async () => {
  const llm = fakeLlm([fence(REFERENCE.zahlen), (req) => (/Change this existing game/.test(req.user) && /SDK\.grid/.test(req.user) ? fence(REFERENCE.zahlen.replace("'Ziel '", "'Ziel: '")) : 'no')]);
  const { ai, store } = mk(llm);
  const first = await run(ai, body('zahlen schieben'));
  const id = parseLink(first.body.options[0].doc.c).id;
  const r = await run(ai, body('mach die Kacheln größer', { base: id }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id2 = parseLink(r.body.options[0].doc.c).id;
  assert.notEqual(id2, id);
  const w = llm.calls.filter((c) => c.system === CODE_SYSTEM).pop();
  assert.ok(!/__g\(\)|__in\(\)/.test(w.user), 'the base goes in readable, without the harness counters');
  const unknown = await run(ai, body('größer', { base: 'B'.repeat(16) }));
  assert.equal(unknown.body.notyet.what, 'code-base');
  store.revoke(id, 'test');
  const pulled = await run(ai, body('größer', { base: id }));
  assert.equal(pulled.body.notyet.what, 'code-base');
});

function http(store, method, path, { auth, body: b } = {}) {
  return new Promise((resolve) => {
    const res = { status: 0, headers: {}, body: '', writeHead(s, h) { this.status = s; this.headers = h || {}; return this; }, end(x) { this.body = x || ''; resolve(this); } };
    const req = { method, headers: auth ? { authorization: 'Bearer ' + auth } : {}, async *[Symbol.asyncIterator]() { if (b) yield JSON.stringify(b); } };
    store.route(req, res, new URL('http://x' + path)).then((handled) => { if (!handled) resolve(null); });
  });
}

test('die Code-Route: JSON mit nosniff und eigener CSP; 404, 409, 410; zurückziehen nur mit Admin-Token', async () => {
  const store = createCodeStore({ env: { DUELL_ADMIN_TOKEN: 'a'.repeat(20) }, log: () => {} });
  const rec = store.put({ code: 'const GAME = {};', meta: { title: 'T', players: { min: 1, max: 1 }, mode: 'turn', inputs: ['tap'] }, title: 'T', genre: 'zahlen' });
  const ok = await http(store, 'GET', `/api/duell/code/${rec.id}?h=${rec.h}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(ok.headers['Content-Security-Policy'], /default-src 'none'.*sandbox/);
  assert.match(ok.headers['Content-Type'], /application\/json/);
  assert.equal(JSON.parse(ok.body).sig, rec.sig);
  assert.equal((await http(store, 'GET', `/api/duell/code/${rec.id}?h=${'x'.repeat(43)}`)).status, 409);
  assert.equal((await http(store, 'GET', `/api/duell/code/${'Z'.repeat(16)}?h=${rec.h}`)).status, 404);
  assert.equal((await http(store, 'POST', `/api/duell/code/${rec.id}`, { body: { action: 'revoke' } })).status, 401);
  assert.equal((await http(store, 'POST', `/api/duell/code/${rec.id}`, { auth: 'a'.repeat(20), body: { action: 'revoke', why: 'x' } })).status, 200);
  assert.equal((await http(store, 'GET', `/api/duell/code/${rec.id}?h=${rec.h}`)).status, 410);
  const key = JSON.parse((await http(store, 'GET', '/api/duell/code/key')).body);
  assert.equal(key.alg, 'Ed25519'); assert.equal(key.pub, store.pub);
  // the signature binds the code: one changed character fails
  assert.equal(store.verify({ ...rec, code: rec.code + ' ' }), false);
  assert.equal(store.verify({ ...rec, title: 'Other' }), false);
});

test('gemeldet und gesperrt: das Spiel wird serverseitig zurückgezogen (Signatur widerrufen)', async () => {
  const llm = fakeLlm([fence(REFERENCE.zahlen)]);
  const dir = mkdtempSync(join(tmpdir(), 'code-report-'));
  const { ai, d, store } = mk(llm);
  const r = await run(ai, body('zahlen schieben'));
  const o = r.body.options[0];
  const reports = createReports({ env: { DUELL_REPORT_DIR: dir, DUELL_ADMIN_TOKEN: 'b'.repeat(20) }, shared: d.shared, onCode: store, log: () => {} });
  const made = await reports.report({ reason: 'harm', kind: 'karte', seal: r.body.seals[0], option: o }, 'reporter', { headers: {} });
  assert.equal(made.status, 202, JSON.stringify(made.body));
  const id = parseLink(o.doc.c).id;
  assert.equal(store.isRevoked(id), false, 'a report alone pulls nothing');
  const dec = reports.decide(made.body.id, 'block');
  assert.equal(dec.status, 200);
  assert.equal(store.isRevoked(id), true);
});

test('codeOf: nur der erste ```js-Block', () => {
  assert.equal(codeOf('text\n```js\nconst GAME = 1;\n```\nmore'), 'const GAME = 1;');
  assert.equal(codeOf('```\nconst GAME = 2;\n```'), 'const GAME = 2;');
  assert.equal(codeOf('Hier ist dein Spiel!'), '');
});
