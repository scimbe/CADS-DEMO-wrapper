// The pure parts of the harness swarm (eval/): population, split, surface features, reward, statistics, rendering,
// the UI mapping and the cost ledger. No model, no key, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePopulation, makeTasks, splitPersonas, AGE_BANDS, TOPICS } from '../eval/lib/population.mjs';
import { featuresOf, distribution, rewardOf, passOf, meanCi, pairedDelta, weightedKappa } from '../eval/lib/stats.mjs';
import { describe as describeOut } from '../eval/lib/render.mjs';
import { artOf } from '../eval/lib/prompts.mjs';
import { createLedger, envValue, usdOf, retryingFetch } from '../eval/lib/api.mjs';
import { wishTypeOf } from '../eval/lib/sut.mjs';

test('population: seeded, every age band, ~15 % English, ages fit the life situation', () => {
  const a = makePopulation(1), b = makePopulation(1);
  assert.deepEqual(a, b);
  assert.equal(a.length, AGE_BANDS.reduce((s, x) => s + x.n, 0));
  for (const band of AGE_BANDS) assert.ok(a.filter((p) => p.band === band.id).length >= 6, band.id);
  const en = a.filter((p) => p.lang === 'en').length / a.length;
  assert.ok(en > 0.12 && en < 0.18, String(en));
  for (const p of a) { assert.ok(p.age >= 16 && p.age <= 85); if (/Rentner/.test(p.life)) assert.ok(p.age >= 60); if (/Schüler/.test(p.life)) assert.ok(p.age <= 19); }
});
test('tasks: every topic once per persona; split: no persona in two splits', () => {
  const pop = makePopulation(2), tasks = makeTasks(pop, 3, 16);
  assert.equal(tasks.length, pop.length * 16);
  for (const p of pop) for (const t of TOPICS) assert.ok(tasks.some((x) => x.persona === p.id && x.topic === t.id));
  const s = splitPersonas(pop, 4), all = [...s.train, ...s.val, ...s.test];
  assert.equal(new Set(all).size, pop.length);
  assert.equal(all.length, pop.length);
  assert.ok(s.train.length > s.val.length && s.val.length >= s.test.length - 1);
});
test('features: lowercase, emoji, question, imperative, polite, names, llm-ish', () => {
  const f = featuresOf('mach ne karte für oma 🎂', new Set(['Lea']));
  assert.equal(f.allLower, true); assert.equal(f.emoji, true); assert.equal(f.imperative, true); assert.equal(f.family, true); assert.equal(f.words, 6);
  assert.equal(featuresOf('Wann haben alle Zeit?').question, true);
  assert.equal(featuresOf('Karte für Lea', new Set(['Lea'])).named, true);
  assert.equal(featuresOf('Bitte erstelle mir eine ansprechende Karte mit folgenden Elementen').llmish, true);
  const d = distribution([featuresOf('a b'), featuresOf('a b c d e f g')]);
  assert.equal(d.n, 2); assert.equal(d.hist['1-2'], 1); assert.equal(d.hist['6-10'], 1);
});
test('reward: weights sum to 1, a wrong substitute is capped, pass needs routing >= 2', () => {
  assert.ok(Math.abs(rewardOf({ intent: 4, vorstellung: 4, routing: 4, quality: 4 }) - 1) < 1e-9);
  assert.equal(rewardOf({ intent: 4, vorstellung: 4, routing: 0, quality: 4 }), 0.25);
  assert.equal(passOf({ intent: 4, vorstellung: 4, routing: 1, quality: 4 }), false);
  assert.equal(passOf({ intent: 3, vorstellung: 3, routing: 3, quality: 3 }), true);
  assert.equal(passOf({ intent: 2, vorstellung: 2, routing: 2, quality: 2 }), false);
});
test('statistics: bootstrap CI covers the mean, paired delta, weighted kappa', () => {
  const m = meanCi([0, 1, 0, 1, 1, 1, 0, 1]);
  assert.ok(m.lo <= m.mean && m.mean <= m.hi);
  const d = pairedDelta({ a: 0.2, b: 0.4 }, { a: 0.6, b: 0.8 });
  assert.ok(Math.abs(d.delta - 0.4) < 1e-9 && d.lo > 0);
  assert.equal(weightedKappa([[0, 0], [4, 4], [2, 2]]), 1);
  assert.ok(weightedKappa([[0, 4], [4, 0], [1, 3], [3, 1]]) < 0);
});
test('UI mapping: labels to art and genre; a "Bald" chip sends nothing', () => {
  assert.deepEqual(artOf('de', 'Spiel', 'Jump & Run'), { art: 'game', genre: 'G2' });
  assert.deepEqual(artOf('en', 'Game', 'Flying'), { art: 'game', genre: 'G1' });
  assert.deepEqual(artOf('de', 'Spiel', 'Strategie'), { art: 'game', soon: 'strategie' });
  assert.deepEqual(artOf('de', 'Wie eine Karte', '-'), { art: 'faehigkeit' });
  assert.deepEqual(artOf('en', 'Card', '-'), { art: 'card' });
});
test('render: card, ability card, not yet, refusal, crisis', () => {
  const byId = (id) => (id === 'zug-termin' ? { de: { t: 'Wann könnt|ihr alle?', s: 'Termine antippen.' } } : null);
  assert.match(describeOut({ options: [{ doc: { k: 'card', x: 'Alles Gute', st: 'herz', sk: [{ e: '🎂' }] } }] }).text, /Alles Gute.*\n.*🎂/);
  assert.match(describeOut({ options: [{ doc: { k: 'turn', i: 'zug-termin', t: 'Grillen' } }] }, byId).text, /Wann könnt ihr alle\?.*Grillen/);
  assert.match(describeOut({ notyet: { what: 'game', name: 'Schach' }, catalog: ['zug-termin'] }, byId).text, /Schach.*Wann könnt ihr alle/);
  assert.equal(describeOut({ fail: 'unkind', why: 'ok-false' }).kind, 'refused');
  assert.equal(describeOut({ crisis: true }).kind, 'crisis');
  assert.equal(wishTypeOf({ k: 'turn', pk: {} }), '');
  assert.equal(wishTypeOf({ k: 'photo' }), 'photo');
});
test('ledger: refuses a call past the cap, books by role, survives a restart', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'l.json');
  const l = createLedger(f, 1);
  const rel = l.hold(0.6);
  assert.throws(() => l.hold(0.5), (e) => e.code === 'cap');
  rel(); l.book('judge', 0.7, { in: 10 });
  assert.throws(() => l.hold(0.31), (e) => e.code === 'cap');
  const l2 = createLedger(f, 1);
  assert.equal(l2.get().usd, 0.7); assert.equal(l2.get().byRole.judge.in, 10);
  assert.ok(Math.abs(usdOf('claude-sonnet-5-5', { in: 1e6, out: 1e5 }) - 3) < 1e-9);
});
test('env file: the value of one variable, quotes and comments', () => {
  assert.equal(envValue('A=1\nexport B="x y" \nC=z # note', 'B'), 'x y');
  assert.equal(envValue('C=z # note', 'C'), 'z');
  assert.equal(envValue('D=1', 'E'), '');
});
test('retry: 529 then 200; a 400 is returned at once', async () => {
  let n = 0;
  const f = retryingFetch(async () => ({ status: ++n < 2 ? 529 : 200, ok: n >= 2, headers: { get: () => '0' } }), { baseMs: 1 });
  assert.equal((await f('x')).status, 200); assert.equal(n, 2);
  let m = 0; const g = retryingFetch(async () => { m++; return { status: 400, ok: false, headers: { get: () => null } }; }, { baseMs: 1 });
  assert.equal((await g('x')).status, 400); assert.equal(m, 1);
});
test('ledger: two processes of one run share the total (append-only bookings)', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'l.json');
  const a = createLedger(f, 1), b = createLedger(f, 1);
  a.book('sut', 0.4); b.book('judge', 0.4);
  assert.ok(Math.abs(a.get().usd - 0.8) < 1e-9);
  assert.throws(() => b.hold(0.3), (e) => e.code === 'cap');
});
test('applyWish: the editor fields change, the rest is listed', async () => {
  const { applyWish } = await import('../eval/lib/render.mjs');
  const { doc, rest } = applyWish({ k: 'card', x: 'a', sk: [{ e: '🌻' }] }, { x: 'b', stickers: ['🍵'], colors: ['#000', '#fff'] });
  assert.equal(doc.x, 'b'); assert.deepEqual(doc.sk, [{ e: '🍵' }]); assert.deepEqual(rest, { colors: ['#000', '#fff'] });
});
