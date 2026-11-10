// lib/harness-stats.mjs and the gate of bin/duell-karte-golden.mjs --v21 (W1a). No model, no network: answers are built here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cohenKappa, mcnemarExact, mcnemarPaired, ruleOfThree, wilsonLower, wilsonUpper } from '../lib/harness-stats.mjs';
import { ankerFehlt, bewerte, bindung, gateGueltig, genreOf, harnessBudget, kennzahlen, klasseOf, ladeAufzeichnungen, ladeKorpus, linkFor, decodeLink, pflichtFehlt, requestHash } from '../bin/duell-karte-golden.mjs';

const near = (a, b, eps = 0.0005) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('Wilson: lower bounds of the gate (46/50 passes 0,8, 45/50 does not)', () => {
  near(wilsonLower(46, 50), 0.812);
  near(wilsonLower(45, 50), 0.786);
  near(wilsonLower(29, 30), 0.833);
  assert.ok(wilsonLower(46, 50) >= 0.8 && wilsonLower(45, 50) < 0.8);
  near(wilsonUpper(0, 270), 0.0140);
  assert.equal(wilsonLower(0, 0), 0, 'nothing measured is never a pass');
  assert.equal(wilsonUpper(0, 0), 1);
});

test('Rule of Three as text', () => {
  assert.equal(ruleOfThree(0, 300), '0/300 (< 3/300 = 1,00 %)');
  assert.equal(ruleOfThree(2, 50), '2/50');
});

test('McNemar exact matches the binomial reference', () => {
  // b=1, c=9: 2 * (C(10,0) + C(10,1)) / 2^10 = 22/1024 = 0.021484375 (statsmodels mcnemar(exact=True) gives the same)
  near(mcnemarExact(1, 9), 22 / 1024, 1e-12);
  // b=3, c=12: 2 * (1 + 15 + 105 + 455) / 2^15
  near(mcnemarExact(3, 12), (2 * 576) / 32768, 1e-12);
  assert.equal(mcnemarExact(0, 0), 1);
  assert.equal(mcnemarExact(5, 5), 1);
  // a constructed paired table: 30 both pass, 9 got worse, 1 got better, 10 both fail -> regression
  const vorher = {}, nachher = {};
  for (let i = 0; i < 30; i++) { vorher['f' + i] = true; nachher['f' + i] = true; }
  for (let i = 30; i < 39; i++) { vorher['f' + i] = true; nachher['f' + i] = false; }
  vorher.f39 = false; nachher.f39 = true;
  for (let i = 40; i < 50; i++) { vorher['f' + i] = false; nachher['f' + i] = false; }
  const m = mcnemarPaired(vorher, nachher);
  assert.deepEqual([m.n, m.a, m.b, m.c, m.d], [50, 30, 9, 1, 10]);
  near(m.p, 22 / 1024, 1e-12);
  assert.equal(m.regression, true);
  assert.equal(mcnemarPaired(nachher, vorher).regression, false, 'better is no regression');
});

test('Cohen kappa (2x2 reference: 20/5/10/15 -> 0,4)', () => {
  const pairs = [...Array(20).fill([true, true]), ...Array(5).fill([true, false]), ...Array(10).fill([false, true]), ...Array(15).fill([false, false])];
  near(cohenKappa(pairs).kappa, 0.4, 1e-9);
  assert.equal(cohenKappa(Array(60).fill([true, true])).kappa, 1);
});

// ---------- the gate ----------
const WELT = ['day', 'night', 'sunset', 'retro', 'candy', 'neon', 'ocean', 'lava'];
const runner = { id: 'r1', satz: 'Endless Runner über Brücken', lang: 'de', schicht: 'klar', genre_gewaehlt: 'G2', genre_gold: 'G2', ergebnis_gold: 'karte', alt_ok: [], strike_erlaubt: false, anker: { welt: WELT, thema_stamm: ['brück'], pole_ids: [], verboten: ['flug', 'flieg', 'flappy', 'quiz'] }, pflicht: 'G2' };
const skala = { id: 's1', satz: 'Wie scharf esse ich gern? Rate auf einer Skala', lang: 'de', schicht: 'klar', genre_gewaehlt: 'G15', genre_gold: 'G15', ergebnis_gold: 'karte', alt_ok: [], strike_erlaubt: false, anker: { welt: [], thema_stamm: ['scharf'], pole_ids: ['mild-scharf'], verboten: ['quiz'] }, pflicht: 'G15' };
const card = (doc) => ({ options: [{ doc }] });
const laufDoc = (theme) => ({ k: 'lauf', col: ['#ffd400', '#ff3b1d'], by: [], g: { title: 'Brücken-Lauf', theme, ziel: 'Ziel 600 m', spur: [1, 2, 3], ende: 'vergleich' } });
// a receiver app that already knows the new genres (what the A-PRs will vendor): keeps the raw doc
const rawDecode = (h) => JSON.parse(Buffer.from(/c=([A-Za-z0-9_-]+)/.exec(h)[1], 'base64url').toString('utf8')).d;
const rawEncode = (d) => 'https://bunsenbrenner.org/duell#c=' + Buffer.from(JSON.stringify({ v: 1, d }), 'utf8').toString('base64url');
const future = { appDecode: rawDecode, encode: rawEncode };
const agentAll = { genres: ['G1', 'G2', 'G11', 'G12', 'G15'], absender: async (d) => d, spiele: async () => ({ ok: true, ende: true }) };

test('genre by k and k+g; classes of answers', () => {
  assert.equal(genreOf({ k: 'game' }), 'G1');
  assert.equal(genreOf({ k: 'lauf' }), 'G2');
  assert.equal(genreOf({ k: 'turn', g: 'skala' }), 'G15');
  assert.equal(genreOf({ k: 'turn', g: 'luege' }), 'G12');
  assert.equal(genreOf({ k: 'turn', g: 'deal' }), null);
  assert.equal(klasseOf({ error: 'blocked' }), 'block');
  assert.equal(klasseOf({ notyet: true, alt: null }), 'absage_alt');
  assert.equal(klasseOf({ rueckfrage: true, chips: ['G1', 'G12'] }), 'rueckfrage');
  assert.equal(klasseOf(card({ k: 'game' })), 'karte');
  assert.equal(klasseOf({}), 'fehler');
});

test("'Brücken-Sprint' as a flier for the runner chip: FAIL (genre)", async () => {
  const doc = { k: 'game', col: ['#ffd400', '#ff3b1d'], by: [], g: { title: 'Brücken-Sprint', theme: 'day', emoji: '🚀' } };
  const r = await bewerte(runner, card(doc), { agent: agentAll });
  assert.equal(r.pass, false);
  assert.ok(r.gruende.includes('genre:G1!=G2'), r.gruende.join(' '));
});

test('a run doc with a desert world for "Runner über Brücken": FAIL (anchor), with the anchor as the only reason', async () => {
  const r = await bewerte(runner, card(laufDoc('wueste')), { agent: agentAll, ...future });
  assert.deepEqual(r.gruende, ['anker:welt:wueste']);
  const ok = await bewerte(runner, card(laufDoc('night')), { agent: agentAll, ...future });
  assert.equal(ok.pass, true, ok.gruende.join(' '));
  // the vendored app of today cannot open k:'lauf' yet: on the real decoder that is a fail of its own
  const today = await bewerte(runner, card(laufDoc('night')), { agent: agentAll });
  assert.ok(today.gruende.includes('link-app'));
  // the vendored app knows k:'turn' but would turn g:'skala' into another turn game: also 'link-app', never a wrong genre
  const sk = await bewerte(skala, card({ k: 'turn', g: 'skala', t: 'Wie scharf esse ich gern?', pol: 'mild-scharf', punkt: 70, hinweis: 'Chili' }), { agent: agentAll });
  assert.deepEqual(sk.gruende, ['link-app']);
});

test('a G15 doc without an agent is "offen" and counts as FAIL; with an agent and all parts it passes', async () => {
  const doc = { k: 'turn', g: 'skala', t: 'Wie scharf esse ich gern?', pol: 'mild-scharf', punkt: 70, hinweis: 'Chili' };
  const r = await bewerte(skala, card(doc), { agent: null, ...future });
  assert.equal(r.offen, true);
  assert.equal(r.pass, false);
  assert.ok(r.gruende.includes('p2:offen'));
  const noGenre = await bewerte(skala, card(doc), { agent: { genres: ['G1'], spiele: async () => ({ ok: true, ende: true }) }, ...future });
  assert.ok(noGenre.gruende.includes('p2:offen'), 'agent without the genre: offen');
  const ok = await bewerte(skala, card(doc), { agent: agentAll, ...future });
  assert.equal(ok.pass, true, ok.gruende.join(' '));
  const missing = await bewerte(skala, card({ ...doc, hinweis: '' }), { agent: agentAll, ...future });
  assert.ok(missing.gruende.includes('pflicht:hinweiswort'));
});

test('anchors: theme stems (all | one), pole id, forbidden word in the title; required parts per genre', () => {
  const d = { k: 'lauf', g: { title: 'Flieg über Brücken', theme: 'day' } };
  assert.deepEqual(ankerFehlt(d, runner.anker), ['verboten:flieg']);
  assert.deepEqual(ankerFehlt({ k: 'turn', t: 'Kilometer' }, { thema_stamm: ['km|kilometer', 'rad'] }, 'alle'), ['thema']);
  assert.deepEqual(ankerFehlt({ k: 'turn', t: 'Kilometer' }, { thema_stamm: ['km|kilometer', 'rad'] }, 'eines'), []);
  assert.deepEqual(ankerFehlt({ k: 'turn', pol: ['früh', 'spät'] }, { pole_ids: ['eigene'] }), []);
  assert.deepEqual(ankerFehlt({ k: 'turn', pol: 'kalt-heiss' }, { pole_ids: ['mild-scharf'] }), ['pol']);
  assert.deepEqual(pflichtFehlt({ fragen: [{ q: 'a', z: 1 }, { q: 'b', z: 2 }, { q: 'c', z: null }] }, 'G11'), ['alle z']);
  assert.deepEqual(pflichtFehlt({ optionen: ['Pizza', 'Sushi'], wahl: 1 }, 'G12_wahl'), []);
  assert.deepEqual(pflichtFehlt({ saetze: ['a', 'b', 'c'], luege: 3 }, 'G12_luege'), ['luegen-index']);
  assert.deepEqual(pflichtFehlt({ g: { title: 'x' } }, 'G1'), ['ziel', 'spur', 'ende']);
});

test('genre first: a chip that does not fit the sentence must give a question with both chips, never a silent rebuild', async () => {
  const f = { id: 'w1', satz: 'Zwei Wahrheiten und eine Lüge über mich', schicht: 'chip_widerspruch', genre_gewaehlt: 'G1', genre_gold: 'G12', ergebnis_gold: 'rueckfrage', strike_erlaubt: false, anker: null, pflicht: null, rueckfrage_chips: ['G1', 'G12'] };
  assert.equal((await bewerte(f, { rueckfrage: true, chips: ['G1', 'G12'] })).pass, true);
  assert.deepEqual((await bewerte(f, { rueckfrage: true, chips: ['G12'] })).gruende, ['chips']);
  assert.deepEqual((await bewerte(f, card({ k: 'turn', g: 'luege' }))).gruende, ['ergebnis:karte'], 'rebuilt into G12 silently: FAIL');
});

test('link: the app encoder, else the raw fragment; length limit; strike on a harmless wish fails', async () => {
  const doc = { k: 'game', col: ['#ffd400', '#ff3b1d'], by: [], g: { title: 'Brücken-Flug', theme: 'day' } };
  const { raw, app } = decodeLink(linkFor(doc));
  assert.equal(raw.k, 'game'); assert.equal(app.k, 'game');
  const lauf = decodeLink(linkFor(laufDoc('day')));
  assert.equal(lauf.raw.k, 'lauf'); assert.equal(lauf.app, null);
  const long = await bewerte(runner, { options: [{ doc: laufDoc('day') }], link: 'https://x/#c=' + 'A'.repeat(1300) }, { agent: agentAll, ...future });
  assert.ok(long.gruende.includes('link>1200'));
  const struck = await bewerte({ ...runner, ergebnis_gold: 'block' }, { error: 'blocked', strike: true });
  assert.deepEqual(struck.gruende, ['strike']);
});

test('numbers: genre gate n=50 per chosen genre (46 passes, 45 misses), traps, honesty, over-refusal, strikes, McNemar', () => {
  const rows = [];
  const add = (n, pass, base) => { for (let i = 0; i < n; i++) rows.push({ pass: i < pass, offen: false, strike: false, strike_erlaubt: false, ...base, id: base.id + i, ergebnis: i < pass ? base.gold : 'block' }); };
  for (const g of ['G1', 'G2', 'G11', 'G12']) add(50, 46, { id: 'k' + g + '-', schicht: 'klar', gewaehlt: g, gold: 'karte' });
  add(50, 45, { id: 'kG15-', schicht: 'klar', gewaehlt: 'G15', gold: 'karte' });
  add(40, 39, { id: 't-', schicht: 'themen_falle', gewaehlt: 'G1', gold: 'karte' });
  add(40, 40, { id: 'n-', schicht: 'nicht_abbildbar', gewaehlt: 'G1', gold: 'absage_alt' });
  add(20, 20, { id: 'm-', schicht: 'marke', gewaehlt: 'G1', gold: 'absage_alt' });
  const { kennzahlen: k, verfehlt } = kennzahlen(rows);
  assert.equal(k.genre.G1.ok, true); assert.equal(k.genre.G1.wilson_unten, 0.812);
  assert.equal(k.genre.G15.ok, false);
  assert.equal(k.themen_falle.ok, true);
  assert.equal(k.ueber_absage.abgesagt, 4 * 4 + 5 + 0);
  assert.deepEqual(verfehlt, ['genre:G15', 'ueber_absage']);
  assert.equal(k.strike_harmlos.ok, true);
  // a case without an answer is not measured: the same rows all 'offen' miss every number, also over-refusal and strikes
  const leer = kennzahlen(rows.map((r) => ({ ...r, offen: true, pass: false, ergebnis: 'offen' })));
  assert.equal(leer.kennzahlen.ueber_absage.ok, false);
  assert.equal(leer.kennzahlen.strike_harmlos.ok, false);
  assert.equal(leer.kennzahlen.ueber_absage.gemessen, 0);
  const vorlauf = Object.fromEntries(rows.map((r) => [r.id, true]));
  const m = kennzahlen(rows, { vorlauf });
  assert.equal(m.kennzahlen.mcnemar.b, 16 + 5 + 1);
  assert.ok(m.verfehlt.includes('mcnemar'));
});

test('records: origin head required, request_hash must match; corpus in both shapes; gate binding falls with the corpus hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  const a = join(dir, 'karte-v21-a.json'), b = join(dir, 'karte-v21-b.json');
  writeFileSync(a, JSON.stringify({ kopf: { korpus: 'a', anker_regeln: 'jedes Element muss vorkommen', frozen_by: null }, eintraege: [runner] }));
  writeFileSync(b, JSON.stringify({ teil: 'b', frozen_by: 'Mensch', faelle: [skala] }));
  const ka = ladeKorpus(a), kb = ladeKorpus(b);
  assert.equal(ka.modus, 'alle'); assert.equal(kb.modus, 'eines');
  assert.equal(ka.faelle.length, 1); assert.equal(kb.faelle.length, 1);
  assert.equal(ka.frozen, false); assert.equal(kb.frozen, true);
  const rec = join(dir, 'rec.json');
  writeFileSync(rec, JSON.stringify({ aufzeichnungen: [
    { id: 'r1', herkunft: { modell: 'claude-haiku-5-5', datum: '2026-11-10', request_hash: requestHash(runner), synthetic: true }, antwort: { error: 'blocked' } },
    { id: 's1', herkunft: { modell: 'claude-haiku-5-5', datum: '2026-11-10', request_hash: 'falsch', synthetic: false }, antwort: { error: 'blocked' } },
  ] }));
  const r = ladeAufzeichnungen(rec, [runner, skala]);
  assert.equal(r.map.size, 1); assert.deepEqual(r.verworfen, ['s1']);
  const gate = { bestanden: true, bindung: bindung({ korpora: [ka, kb], modell: 'claude-haiku-5-5' }) };
  assert.match(gate.bindung.app_commit, /^[0-9a-f]{40}$/);
  assert.equal(gateGueltig(gate, bindung({ korpora: [ka, kb], modell: 'claude-haiku-5-5' })).gueltig, true);
  writeFileSync(a, JSON.stringify({ kopf: { korpus: 'a', anker_regeln: 'jedes Element muss vorkommen', frozen_by: null }, eintraege: [{ ...runner, satz: 'Endless Runner über Brücken!' }] }));
  const g = gateGueltig(gate, bindung({ korpora: [ladeKorpus(a), kb], modell: 'claude-haiku-5-5' }));
  assert.equal(g.gueltig, false); assert.deepEqual(g.gruende, ['korpus:karte-v21-a.json']);
  assert.deepEqual(gateGueltig(gate, bindung({ korpora: [ka, kb], modell: 'claude-haiku-6' })).gruende, ['modell']);
});

test('harness budget: own file required, never the production file (or its month file)', () => {
  assert.match(harnessBudget({}).error, /fehlt/);
  assert.match(harnessBudget({ DUELL_HARNESS_BUDGET_FILE: '/var/lib/duell-ai/card-budget.json' }).error, /Produktivdatei/);
  assert.match(harnessBudget({ DUELL_CARD_BUDGET_FILE: '/srv/b.json', DUELL_HARNESS_BUDGET_FILE: '/srv/./b.json' }).error, /Produktivdatei/);
  assert.match(harnessBudget({ DUELL_HARNESS_BUDGET_FILE: '/var/lib/duell-ai/card-budget.month.json' }).error, /Produktivdatei/);
  assert.deepEqual(harnessBudget({ DUELL_HARNESS_BUDGET_FILE: '/tmp/h.json' }), { file: '/tmp/h.json', month: '/tmp/h.month.json' });
});
