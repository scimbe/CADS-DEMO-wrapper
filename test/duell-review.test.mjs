// Review findings of PR #91 (B1-B5, then N1, N2 and the rests of B4 and B5d): each test reproduces one finding and failed before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell, makeLlm } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { createReports } from '../lib/duell-report.mjs';
import { createQueue } from '../lib/duell-queue.mjs';
import { mintKey } from '../lib/duell-pots.mjs';

const S = 'entitlement-secret-for-tests';
const GOOD = JSON.stringify({ options: ['a eins', 'b zwei', 'c drei'] });
const CONF = JSON.stringify({ gravity: 1500, theme: 'night', emoji: '🚀', title: 'Rakete' });
const dev = (c) => c.repeat(32);
const tick = () => new Promise((r) => setImmediate(r));
function mk({ env = {}, duellEnv = {}, llm, now } = {}) {
  const fn = llm || (async (s, u) => (u.startsWith('<wish>') ? CONF : GOOD));
  const d = createDuell({ env: { DUELL_DAILY_MAX: '50', DUELL_SEAL_SECRET: 'seal', ...duellEnv }, salt: 's', log: () => {}, llm: fn, now });
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0', DUELL_ENTITLEMENT_SECRET: S, ...env }, llm: fn, shared: d.shared, log: () => {}, now });
  return { d, ai };
}
const line = (text, device, key) => ({ kind: 'line', input: { text, style: 'neon' }, device, lang: 'de', ...(key ? { key } : {}) });
const gated = () => { let open; const gate = new Promise((r) => { open = r; }); return { gate, open }; };

test('B1: zwei Teammitglieder mit eigenem Geraet laufen gleichzeitig; dasselbe Geraet bleibt bei einer Anfrage', async () => {
  for (const tier of ['biz', 'pro']) {
    const key = mintKey(S, tier, 'team'), g = gated();
    const { ai } = mk({ env: { DUELL_ENTITLEMENTS: key }, llm: async () => { await g.gate; return GOOD; } });
    const a = ai.act(line('alpha', dev('a'), key), await ai.who(null, { device: dev('a'), key }), null);
    await tick();
    const same = await ai.act(line('nochmal', dev('a'), key), await ai.who(null, { device: dev('a'), key }), null);
    assert.equal(same.status, 409, `${tier}: one open request per device`);
    const b = ai.act(line('beta', dev('b'), key), await ai.who(null, { device: dev('b'), key }), null);
    await tick(); g.open();
    assert.equal((await a).status, 200);
    const rb = await b;
    assert.equal(rb.status, 200, `${tier}: a second team member is not blocked by the first (${rb.body.error})`);
  }
});

test('B2: ein nie abgeholtes Ticket macht die Spielkonfiguration nicht kostenlos und wird beim Verfall belastet', async () => {
  let t = Date.parse('2026-11-04T12:00:00Z');
  const g = gated();
  const { d, ai } = mk({ now: () => t, duellEnv: { DUELL_QUEUE_HOLD_MS: '20' }, llm: async (s, u) => { await g.gate; return u.startsWith('<wish>') ? CONF : GOOD; } });
  const D = dev('c');
  const q = await d.config({ prompt: 'unterwasser', lang: 'de', device: D, queue: 'ticket' }, 'ip1');
  assert.equal(q.status, 202);
  g.open(); await new Promise((r) => setTimeout(r, 30));
  const again = await d.config({ prompt: 'unterwasser', lang: 'de', device: D }, 'ip1');
  assert.equal(again.status, 200);
  assert.notEqual(again.body.cost, 0, 'the uncollected result is no free cache entry');
  assert.equal(again.body.meter.remaining, 6);
  t += 61000;   // past DUELL_QUEUE_TICKET_TTL_S: the ready but uncollected result is charged
  assert.equal((await d.poll({ ticket: q.body.ticket })).status, 404);
  assert.equal(ai.meter(await ai.who(null, D)).remaining, 5, 'an uncollected result used the GPU and costs like a collected one');
});

test('B2: eine KI-Aktion mit Ticket, die niemand abholt, wird beim Verfall belastet', async () => {
  let t = Date.parse('2026-11-04T12:00:00Z');
  const g = gated();
  const { d, ai } = mk({ now: () => t, duellEnv: { DUELL_QUEUE_HOLD_MS: '20' }, llm: async () => { await g.gate; return GOOD; } });
  const D = dev('e'), p = await ai.who(null, D);
  const q = await ai.act({ ...line('nie abgeholt', D), queue: 'ticket' }, p, null);
  assert.equal(q.status, 202);
  g.open(); await new Promise((r) => setTimeout(r, 30));
  assert.equal(ai.meter(p).remaining, 7, 'not yet: the ticket may still be collected');
  t += 61000;
  await d.poll({ ticket: 'x' });   // any poll sweeps
  assert.equal(ai.meter(p).remaining, 6);
});

test('B3: eine verworfene Quittung bringt auch nach 30 weiteren Quittungen keine zweite Erstattung', async () => {
  const pro = mintKey(S, 'pro', 'fam');
  const { ai } = mk({ env: { DUELL_ENTITLEMENTS: pro }, duellEnv: { DUELL_DAILY_MAX: '500' } });
  const D = dev('a'), p = await ai.who(null, { device: D, key: pro });
  const go = async (t) => (await ai.act(line(t, D, pro), p, null)).body.receipt;
  const A = await go('erste');
  assert.equal(ai.close(p, A, 'discard').body.refunded, 1);
  for (let i = 0; i < 30; i++) ai.close(p, await go('k' + i), 'accept');
  const twice = ai.close(p, A, 'discard').body;
  assert.equal(twice.refunded, 0, 'the same receipt is refunded once');
  assert.equal(twice.already, true);
});

test('B3: erledigte Quittungen bleiben nur bis zu ihrem Ablauf gespeichert', async () => {
  let t = Date.parse('2026-11-04T12:00:00Z');
  const pro = mintKey(S, 'pro', 'fam');
  const { ai } = mk({ now: () => t, env: { DUELL_ENTITLEMENTS: pro } });
  const D = dev('a'), p = await ai.who(null, { device: D, key: pro });
  const r1 = (await ai.act(line('eins', D, pro), p, null)).body.receipt;
  ai.close(p, r1, 'accept');
  t += 31 * 60000;
  const r2 = (await ai.act(line('zwei', D, pro), p, null)).body.receipt;
  ai.close(p, r2, 'accept');
  const e = [...ai._store.map.values()].find((v) => Array.isArray(v.z));
  assert.equal(e.z.length, 1, 'the expired receipt left the list');
});

test('B4: Meldung zum Protokoll speichert keinen Inhalt; offene Inhalte und alte Datensaetze haben eine Loeschfrist', async () => {
  let t = Date.parse('2026-11-04T12:00:00Z');
  const dir = mkdtempSync(join(tmpdir(), 'duell-review-'));
  const d = createDuell({ env: { DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: async () => GOOD, now: () => t });
  const rep = createReports({ env: { DUELL_REPORT_DIR: dir, DUELL_ADMIN_TOKEN: 'admin-token-0123456789abcdef', DUELL_REPORT_KEEP_DAYS: '30' }, shared: d.shared, log: () => {}, now: () => t });
  const proto = { title: 'Teamrunde', participants: ['Erika Muster'], topics: ['Budget'], decisions: [], tasks: [] };
  const seal = d.shared.sealer.seal('protokoll', proto, t);
  const r = rep.report({ reason: 'wrong', kind: 'protokoll', seal, content: proto, consent: true }, null);
  assert.equal(r.status, 202);
  const raw = readFileSync(rep._file(), 'utf8');
  assert.ok(!raw.includes('Erika'), 'names of third parties in a protocol are never stored');
  assert.equal(rep.open()[0].sealOk, true, 'the seal is still checked');
  const card = rep.report({ reason: 'harm', kind: 'line', content: 'Frosch im Hals', consent: true }, null).body.id;
  const closed = rep.report({ reason: 'harm', kind: 'line', content: 'weg', consent: true }, null).body.id;
  rep.decide(closed, 'dismiss');
  t += 31 * 86400000;
  const open = rep.open();
  assert.equal(open.find((x) => x.id === card).content, undefined, 'an open report loses its content after DUELL_REPORT_KEEP_DAYS');
  assert.ok(!readFileSync(rep._file(), 'utf8').includes('Frosch'), 'also in the file');
  assert.equal(rep.decide(closed, 'dismiss').status, 404, 'a closed record is gone after the period');
  t += 31 * 86400000;
  assert.equal(rep.open().length, 0, 'an open record without content leaves after twice the period');
});

test('B5: wer auf dieselbe Spielkonfiguration wartet, bekommt nicht die Ablehnung einer fremden IP', async () => {
  const { d } = mk({ duellEnv: { DUELL_IP_PER_HOUR: '1' } });
  assert.equal((await d.config({ prompt: 'vorher', lang: 'de' }, 'ipA')).status, 200);
  const a = d.config({ prompt: 'unterwasser', lang: 'de' }, 'ipA');
  const b = d.config({ prompt: 'unterwasser', lang: 'de' }, 'ipB');
  assert.equal((await a).body.error, 'rate-limited');
  const rb = await b;
  assert.equal(rb.status, 200, `ipB has its own limit (${rb.body.error})`);
});

test('B5: bei fast leerem Topf wird die Ausgabe des Modells auf das begrenzt, was der Topf noch traegt', async () => {
  const caps = [];
  const { ai } = mk({ llm: async (s, u, o) => { caps.push(o && o.maxTokens); return GOOD; } });
  const D = dev('a'), p = await ai.who(null, D);
  for (let i = 0; i < 6; i++) await ai.act(line('karte ' + i, D), p, null);
  assert.equal(ai.meter(p).remaining, 1);
  await ai.act(line('letzte', D), p, null);
  assert.equal(caps[0], undefined, 'a full pot keeps the default');
  assert.equal(caps.at(-1), 300, 'one unit left: at most 300 output tokens (cost 1)');
  let body;
  const call = makeLlm({ baseUrl: 'http://x', maxTokens: 600, fetchImpl: async (u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ choices: [{ message: { content: GOOD } }] }) }; } });
  await call('s', 'u', { maxTokens: 300 });
  assert.equal(body.max_tokens, 300);
  await call('s', 'u');
  assert.equal(body.max_tokens, 600);
});

test('B5: ein Pro-Geraet zaehlt erst, wenn es ein Ergebnis bekommen hat', async () => {
  let t = Date.parse('2026-11-04T12:00:00Z');
  const pro = mintKey(S, 'pro', 'fam');
  const { d, ai } = mk({ now: () => t, env: { DUELL_ENTITLEMENTS: pro, DUELL_AI_PRO_DEVICES: '1' }, duellEnv: { DUELL_DAILY_MAX: '1' } });
  await d.config({ prompt: 'tagesgrenze', lang: 'de' }, null);
  const refused = await ai.act(line('a', dev('a'), pro), await ai.who(null, { device: dev('a'), key: pro }), null);
  assert.equal(refused.body.error, 'daily-limit');
  t += 86400000;
  const r = await ai.act(line('b', dev('b'), pro), await ai.who(null, { device: dev('b'), key: pro }), null);
  assert.equal(r.status, 200, `the refused device took no place (${r.body.error})`);
  assert.equal((await ai.act(line('c', dev('a'), pro), await ai.who(null, { device: dev('a'), key: pro }), null)).body.error, 'devices');
});

test('B5: wartende neue Geraete belegen ihren Platz unter DUELL_AI_NEW_PER_HOUR sofort; ein Fehlschlag gibt ihn frei', async () => {
  const g = gated();
  let mode = 'wait';
  const { ai } = mk({ env: { DUELL_AI_NEW_PER_HOUR: '1' }, duellEnv: { DUELL_IP_PER_HOUR: '99' }, llm: async () => { if (mode === 'down') throw new Error('x'); await g.gate; return GOOD; } });
  const a = ai.act(line('neu eins', dev('a')), await ai.who(null, dev('a')), null);
  await tick();
  const b = await ai.act(line('neu zwei', dev('b')), await ai.who(null, dev('b')), null);
  assert.equal(b.body.error, 'new-limit', 'the slot of the waiting newcomer is taken');
  g.open(); assert.equal((await a).status, 200);
  const fresh = mk({ env: { DUELL_AI_NEW_PER_HOUR: '1' }, llm: async () => { if (mode === 'down') throw new Error('x'); return GOOD; } });
  mode = 'down';
  assert.equal((await fresh.ai.act(line('kaputt', dev('c')), await fresh.ai.who(null, dev('c')), null)).status, 503);
  mode = 'ok';
  assert.equal((await fresh.ai.act(line('danach', dev('d')), await fresh.ai.who(null, dev('d')), null)).status, 200, 'a failed first try gives the slot back');
});

test('B5 (Beschreibung): bei voller Schlange verdraengt Business auch einen wartenden Pro-Auftrag, nicht nur Free', async () => {
  const q = createQueue({ maxLen: 2, maxWaitMs: 0 });
  let release; const block = new Promise((r) => { release = r; });
  q.submit({ tier: 'free', task: () => block });
  const p1 = q.submit({ tier: 'pro', task: async () => 1 }), p2 = q.submit({ tier: 'pro', task: async () => 2 });
  const b = q.submit({ tier: 'business', task: async () => 3 });
  assert.ok(!b.error);
  assert.deepEqual(await p2.done, { error: 'queue-full' }, 'the lowest ranked waiting job leaves, here a Pro job');
  release(); assert.deepEqual(await p1.done, { value: 1 });
});

// ---- Nachfix: N1, N2, Siegel beim Melden, Loeschfrist ohne Verkehr, B5d-Rest -----------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reports = (env = {}, now) => {
  const d = createDuell({ env: { DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: async () => GOOD, now });
  const rep = createReports({ env: { DUELL_REPORT_DIR: mkdtempSync(join(tmpdir(), 'duell-review-')), DUELL_ADMIN_TOKEN: 'admin-token-0123456789abcdef', ...env }, shared: d.shared, log: () => {}, now });
  return { d, rep, rows: () => readFileSync(rep._file(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
};

test('N1: gleichzeitige neue Geraete eines Pro-Schluessels kommen nicht ueber DUELL_AI_PRO_DEVICES', async () => {
  const pro = mintKey(S, 'pro', 'fam'), g = gated();
  const { d, ai } = mk({ env: { DUELL_ENTITLEMENTS: pro, DUELL_AI_PRO_DEVICES: '2' }, duellEnv: { DUELL_DAILY_MAX: '500', DUELL_QUEUE_HOLD_MS: '20' }, llm: async () => { await g.gate; return GOOD; } });
  const rs = [];
  for (const c of ['1', '2', '3', '4']) rs.push(await ai.act({ ...line('t' + c, dev(c), pro), queue: 'ticket' }, await ai.who(null, { device: dev(c), key: pro }), null));
  assert.deepEqual(rs.map((r) => r.status + (r.body.error ? ':' + r.body.error : '')), ['202', '202', '403:devices', '403:devices'], 'waiting devices hold their place');
  g.open();
  for (const r of rs.slice(0, 2)) { let x; do { x = await d.poll({ ticket: r.body.ticket }); } while (x.status === 202); assert.equal(x.status, 200); }
  assert.equal((await ai.act(line('spaeter', dev('5'), pro), await ai.who(null, { device: dev('5'), key: pro }), null)).body.error, 'devices');
});

test('N1: ein Pro-Geraet ohne Ergebnis (Fehler, Ablehnung) gibt seinen reservierten Platz zurueck', async () => {
  const pro = mintKey(S, 'pro', 'fam');
  let down = true;
  const { ai } = mk({ env: { DUELL_ENTITLEMENTS: pro, DUELL_AI_PRO_DEVICES: '1' }, llm: async () => { if (down) throw new Error('x'); return GOOD; } });
  assert.equal((await ai.act(line('kaputt', dev('a'), pro), await ai.who(null, { device: dev('a'), key: pro }), null)).status, 503);
  down = false;
  const r = await ai.act(line('danach', dev('b'), pro), await ai.who(null, { device: dev('b'), key: pro }), null);
  assert.equal(r.status, 200, `the failed device gave its place back (${r.body.error})`);
});

test('N2: zwei Geraete am letzten Rest des Topfs bekommen ihn nicht doppelt; ein Fehlschlag gibt die Reservierung frei', async () => {
  const pro = mintKey(S, 'pro', 'fam'), g = gated();
  let down = false;
  const { ai } = mk({ env: { DUELL_ENTITLEMENTS: pro, DUELL_AI_PRO_PER_MONTH: '2' }, duellEnv: { DUELL_DAILY_MAX: '500' }, llm: async () => { await g.gate; if (down) throw new Error('x'); return { text: GOOD, usage: { completion_tokens: 250 } }; } });
  const A = dev('a'), B = dev('b'), pA = await ai.who(null, { device: A, key: pro }), pB = await ai.who(null, { device: B, key: pro });
  g.open();
  assert.equal((await ai.act(line('erste', A, pro), pA, null)).body.cost, 1);
  assert.equal(ai.meter(pA).remaining, 1);
  const [x, y] = await Promise.all([ai.act(line('ra', A, pro), pA, null), ai.act(line('rb', B, pro), pB, null)]);
  assert.deepEqual([x, y].map((r) => r.status + ':' + (r.body.error || r.body.cost)), ['200:1', '429:quota'], 'the second device sees the unit held by the first');
  const pro2 = mintKey(S, 'pro', 'fam2'), m = mk({ env: { DUELL_ENTITLEMENTS: pro2, DUELL_AI_PRO_PER_MONTH: '1' }, llm: async () => { if (down) throw new Error('x'); return GOOD; } });
  const qA = await m.ai.who(null, { device: A, key: pro2 }), qB = await m.ai.who(null, { device: B, key: pro2 });
  down = true; assert.equal((await m.ai.act(line('kaputt', A, pro2), qA, null)).status, 503);
  down = false;
  const r = await m.ai.act(line('danach', B, pro2), qB, null);
  assert.equal(r.status, 200, `a failure gives the held unit back (${r.body.error})`); assert.equal(r.body.cost, 1);
});

test('N2: die Kappung der Ausgabe rechnet mit dem Rest nach den Reservierungen der anderen', async () => {
  const pro = mintKey(S, 'pro', 'fam'), g = gated(), caps = [];
  const { ai } = mk({ env: { DUELL_ENTITLEMENTS: pro, DUELL_AI_PRO_PER_MONTH: '3' }, duellEnv: { DUELL_DAILY_MAX: '500', DUELL_LLM_PARALLEL: '2' }, llm: async (s, u, o) => { caps.push(o && o.maxTokens); await g.gate; return GOOD; } });
  const a = ai.act(line('eins', dev('a'), pro), await ai.who(null, { device: dev('a'), key: pro }), null);
  await tick();
  const b = ai.act(line('zwei', dev('b'), pro), await ai.who(null, { device: dev('b'), key: pro }), null);
  await tick(); await tick(); g.open(); await a; await b;
  assert.deepEqual(caps, [undefined, 900], 'three left, one held by the first device: the second may cost at most 2');
});

test('Melden: das Siegel wird gegen die gesiegelte Option geprueft, der Inhalt bleibt der eingewilligte', async () => {
  const { d, rep, rows } = reports();
  const option = 'Frosch mit Hut', seal = d.shared.sealer.seal('line', option, Date.now());
  assert.equal(rep.report({ reason: 'harm', kind: 'line', seal, option, consent: true, content: { type: 'card', x: option } }, null).status, 202);
  assert.equal(rep.report({ reason: 'harm', kind: 'line', seal, option }, null).status, 202);
  assert.equal(rep.report({ reason: 'harm', kind: 'line', seal, option: option + '!' }, null).status, 202);
  const [a, b, c] = rows();
  assert.equal(a.sealOk, true, 'the seal holds for the option the app shows'); assert.deepEqual(a.content, { type: 'card', x: option });
  assert.equal(b.sealOk, true, 'checking needs no consent: the option itself is never stored'); assert.equal(b.content, undefined); assert.ok(!JSON.stringify(b).includes('Frosch'));
  assert.equal(c.sealOk, false);
});

test('Melden: ob Inhalt gespeichert wird, entscheidet das kind aus dem Siegel, nicht das des Clients', async () => {
  const { d, rep, rows } = reports();
  const proto = { title: 'Teamrunde', participants: ['Erika Muster'], topics: ['Budget'], decisions: [], tasks: [] };
  const seal = d.shared.sealer.seal('protokoll', proto, Date.now());
  for (const kind of [undefined, 'line']) assert.equal(rep.report({ reason: 'wrong', kind, seal, option: proto, consent: true, content: proto }, null).status, 202);
  assert.equal(rep.report({ reason: 'wrong', kind: 'line', seal, consent: true, content: proto }, null).status, 202);
  assert.ok(!readFileSync(rep._file(), 'utf8').includes('Erika'), 'a protocol is never stored, whatever kind the client sends');
  assert.deepEqual(rows().map((r) => [r.kind, r.sealOk]), [['protokoll', true], ['protokoll', true], ['protokoll', true]]);
  const long = 's1.line.abc.' + 'A'.repeat(150);
  rep.report({ reason: 'other', kind: 'line', seal: long }, null);
  assert.equal(rows().at(-1).seal, long, 'a seal up to 200 characters is kept, as the app allows');
});

test('Melden: die Loeschfrist greift auch ohne Verkehr (Zeitgeber)', async () => {
  let t = Date.parse('2026-11-04T12:00:00Z');
  const { rep } = reports({ DUELL_REPORT_KEEP_DAYS: '30', DUELL_REPORT_EXPIRE_MS: '10' }, () => t);
  rep.report({ reason: 'harm', kind: 'line', content: 'Frosch im Hals', consent: true }, null);
  t += 31 * 86400000;
  await wait(40);
  assert.ok(!readFileSync(rep._file(), 'utf8').includes('Frosch'), 'the content left the file without any read or write');
});

test('B5d: die Spielkonfiguration mit Ticket gibt den Platz eines neuen Geraets frei, wenn das Modell scheitert', async () => {
  let down = true; const g = gated();
  const { d } = mk({ env: { DUELL_AI_NEW_PER_HOUR: '1' }, duellEnv: { DUELL_QUEUE_HOLD_MS: '20' }, llm: async (s, u) => { await g.gate; if (down) throw new Error('x'); return u.startsWith('<wish>') ? CONF : GOOD; } });
  const q = await d.config({ prompt: 'unterwasser', lang: 'de', device: dev('a'), queue: 'ticket' }, null);
  assert.equal(q.status, 202);
  g.open(); let x; do { x = await d.poll({ ticket: q.body.ticket }); } while (x.status === 202);
  assert.equal(x.status, 503);
  down = false;
  const r = await d.config({ prompt: 'weltraum', lang: 'de', device: dev('b') }, null);
  assert.equal(r.status, 200, `the failed newcomer gave its place back (${r.body.error})`);
});

test('B5d: ein Ticket, das in der Schlange verfaellt (queue-timeout), gibt Platz und Reservierung zurueck', async () => {
  for (const mode of ['new', 'pro']) {
    const pro = mintKey(S, 'pro', 'fam'), g = gated();
    const { d, ai } = mk({ env: { DUELL_AI_NEW_PER_HOUR: '1', DUELL_ENTITLEMENTS: pro, DUELL_AI_PRO_DEVICES: '1', DUELL_AI_PRO_PER_MONTH: '1' }, duellEnv: { DUELL_QUEUE_HOLD_MS: '10', DUELL_QUEUE_WAIT_MS: '30' }, llm: async (s, u) => { await g.gate; return u.startsWith('<wish>') ? CONF : GOOD; } });
    const as = (c) => (mode === 'pro' ? { device: dev(c), key: pro } : { device: dev(c) });
    const busy = d.config({ prompt: 'blockiert', lang: 'de' }, null);   // holds the one model slot
    await tick();
    const q = await ai.act({ ...line('wartet', dev('a'), mode === 'pro' ? pro : undefined), queue: 'ticket' }, await ai.who(null, as('a')), null);
    assert.equal(q.status, 202);
    await wait(60);
    assert.equal((await d.poll({ ticket: q.body.ticket })).body.error, 'queue-timeout');
    g.open(); await busy;
    const r = await ai.act(line('danach', dev('b'), mode === 'pro' ? pro : undefined), await ai.who(null, as('b')), null);
    assert.equal(r.status, 200, `${mode}: the timed-out ticket gave its place back (${r.body.error})`);
  }
});
