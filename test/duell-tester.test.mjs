// Tester switch (DUELL_TESTER_ACCTS, lib/duell-ai.mjs): only the daily cap of model calls of the listed login addresses is
// raised (DUELL_TESTER_CALLS_PER_DAY, default 300); every other account keeps DUELL_CREATE_CALLS_PER_DAY (default 30).
// An account is its login e-mail (who(): 'a' + mac('account:' + email)); addresses are never logged, only the count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { MOD_SYSTEM } from '../lib/duell-karte.mjs';

// every card call runs into the token limit: a broken answer, never charged, never a strike, but each call counts
const broke = () => ({ calls: 0, configured: true, async generate(req) { this.calls++; return req.system === MOD_SYSTEM ? { json: { risk: 0, cats: [] }, stop: 'end_turn', usage: {} } : { json: null, stop: 'max_tokens', usage: {} }; } });
function mk(env) {
  const who = { email: '' }, lines = [], llm = broke();
  const d = createDuell({ env: { DUELL_DAILY_MAX: '100000', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: async () => '{}' });
  d.shared.age16 = () => true; d.shared.age18 = () => false;
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0', ...env }, llm: async () => '{}', cardLlm: llm, shared: d.shared, auth: { mode: 'gate', identify: async () => ({ email: who.email }) }, log: (o) => lines.push(o) });
  return { ai, who, lines, llm };
}
/** model calls one account can make today before 429 daily-cap */
async function callsUntilCap(m, email) {
  m.who.email = email;
  const before = m.llm.calls;
  for (let i = 0; i < 400; i++) {
    const b = { kind: 'karte', input: { text: 'Karte mit Frosch ' + i, art: 'card', age: 'u18' }, device: 'c'.repeat(32), lang: 'de' };
    const r = await m.ai.act(b, await m.ai.who({}, b), null);
    if (r.body.error === 'daily-cap') return m.llm.calls - before;
    assert.equal(r.status, 503, JSON.stringify(r.body));   // the broken answer: llm-unavailable, nothing charged
  }
  throw new Error('no cap');
}

test('a tester account gets 300 model calls a day, another account stays at 30; the address in any case and spacing', async () => {
  const m = mk({ DUELL_TESTER_ACCTS: ' Tester@Example.org , zwei@example.org' });
  const t = await callsUntilCap(m, 'tester@example.org'), o = await callsUntilCap(m, 'lea@example.org');
  assert.ok(t > 270 && t <= 300, 'tester: ' + t);
  assert.ok(o > 24 && o <= 30, 'other: ' + o);
  assert.ok(m.lines.some((l) => l.note === 'Tester-Konten: 2'));
  assert.ok(!JSON.stringify(m.lines).toLowerCase().includes('tester@example.org'), 'no address in the log');
  const n = mk({ DUELL_TESTER_ACCTS: 'tester@example.org', DUELL_TESTER_CALLS_PER_DAY: '60' });
  const c = await callsUntilCap(n, 'tester@example.org');
  assert.ok(c > 54 && c <= 60, 'DUELL_TESTER_CALLS_PER_DAY: ' + c);
});

test('empty or invalid DUELL_TESTER_ACCTS: no testers, with a WARN instead of a silent fault; unset: only the count', async () => {
  for (const v of ['', ' , ', 'keine-adresse, auch@nicht']) {
    const m = mk({ DUELL_TESTER_ACCTS: v });
    assert.ok(m.lines.some((l) => l.level === 'WARN' && /DUELL_TESTER_ACCTS/.test(l.note) && /no tester accounts/.test(l.note)), JSON.stringify(v));
    assert.ok(m.lines.some((l) => l.note === 'Tester-Konten: 0'));
    assert.ok(!JSON.stringify(m.lines).includes('keine-adresse'), 'an invalid entry is not logged either');
    assert.ok((await callsUntilCap(m, 'auch@nicht')) <= 30);
  }
  const mixed = mk({ DUELL_TESTER_ACCTS: 'ok@example.org,kaputt' });
  assert.ok(mixed.lines.some((l) => l.level === 'WARN' && /1 invalid entry ignored$/.test(l.note)));
  assert.ok(mixed.lines.some((l) => l.note === 'Tester-Konten: 1'));
  const none = mk({});
  assert.ok(!none.lines.some((l) => l.level === 'WARN' && /DUELL_TESTER_ACCTS/.test(l.note)));
  assert.ok(none.lines.some((l) => l.note === 'Tester-Konten: 0'));
});

test('lib/duell-tester.mjs parse: trimmed, lower-cased, only keys kept; invalid entries counted; unset is not given', async () => {
  const { parse } = await import('../lib/duell-tester.mjs');
  const t = parse(' A@Example.org ,kaputt,, b@example.org', (m) => 'k:' + m);
  assert.deepEqual([t.count, t.bad, t.given], [2, 1, true]);
  assert.equal(t.isTester('k:a@example.org'), true); assert.equal(t.isTester('k:c@example.org'), false); assert.equal(t.isTester(undefined), false);
  assert.deepEqual([parse(undefined, String).count, parse(undefined, String).given, parse('', String).given], [0, false, true]);
});
