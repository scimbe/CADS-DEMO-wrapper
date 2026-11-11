// The Robot: a card of the deck becomes a free card through the free card's own refine step (lib/duell-frei.mjs,
// lib/duell-karte.mjs runKarte with data.base). Stubbed model only; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi, KINDS } from '../lib/duell-ai.mjs';
import { App, MOD_SYSTEM, SCHEMAS, CARD_SYSTEM, refineArt } from '../lib/duell-karte.mjs';
import { ARCADE_WIN, MISSING, TABLE_RULES, baseOf, deckDoc, freeDoc, freeSchema } from '../lib/duell-frei.mjs';

const DEV = 'c'.repeat(32);
const K = KINDS.karte;
function fakeLlm(card, mod) {
  const calls = [];
  return {
    calls, configured: true,
    async generate(req) {
      calls.push(req);
      if (req.system === MOD_SYSTEM) return { json: mod || { risk: 0, cats: [] }, stop: 'end_turn', usage: { in: 10, out: 8 } };
      const j = typeof card === 'function' ? card(req, calls) : card;
      return { json: j, stop: 'end_turn', usage: { in: 40, out: 60 } };
    },
  };
}
const auth = (email) => ({ mode: 'gate', identify: async () => ({ email }) });
function mk(cardLlm) {
  const d = createDuell({ env: { DUELL_DAILY_MAX: '200', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: async () => '{}' });
  d.shared.age16 = () => true; d.shared.age18 = () => false;
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: async () => '{}', cardLlm, shared: d.shared, auth: auth('lea@example.org'), log: () => {} });
  return { d, ai };
}
const body = (input) => ({ kind: 'karte', input, device: DEV, lang: 'de' });
const run = async (ai, b) => ai.act(b, await ai.who({}, b), null);
const gen = (llm) => llm.calls.filter((c) => c.system === CARD_SYSTEM);

test('deck card and free card take the same refine step: the same call, schema and turn for the same base', async () => {
  const card = { ok: true, title: 'Lava-Mond', emoji: '🚀', theme: 'night', motif: 'none', level: 'easy', route: [{ physik: 'ruhig', thema: 'night', emoji: '🌙' }, { physik: 'normal', thema: 'night', emoji: '🚀' }, { physik: 'schnell', thema: 'night', emoji: '🪐' }] };
  const a = fakeLlm(card), b = fakeLlm(card);
  const deck = await run(mk(a).ai, body({ from: 'spiel-lava', text: 'Im Weltraum bei Nacht, eher leicht' }));
  const free = await run(mk(b).ai, body({ base: baseOf('spiel-lava', null, 'de'), text: 'Im Weltraum bei Nacht, eher leicht' }));
  assert.equal(deck.status, 200, JSON.stringify(deck.body)); assert.equal(free.status, 200, JSON.stringify(free.body));
  const [ga, gb] = [gen(a)[0], gen(b)[0]];
  assert.equal(ga.schema, SCHEMAS.game, 'the flight game is refined in its own schema');
  assert.deepEqual(ga, gb, 'one code path: the same model request');
  assert.match(ga.user, /^This is a change of an existing card\. Card type: game\..*<data>\{"now":\{"title":".*","emoji":/);
  assert.equal(deck.body.options[0].doc.k, 'game');
  assert.equal(deck.body.options[0].doc.g.title, 'Lava-Mond');
  // the game keeps its seed (the gaps) and its colours
  assert.equal(deck.body.options[0].doc.g.seed, baseOf('spiel-lava', null, 'de').g.seed);
});

test('edits are only taken for the same card and only as the app keeps them; their texts are screened like the wish', async () => {
  const canon = deckDoc('zug-einig', 'de');
  // another card's id, markup and unknown fields: the deck card from the catalog, never the client's doc
  assert.deepEqual(baseOf('zug-einig', freeDoc({ ...canon, i: 'zug-sammeln' }), 'de').i, 'zug-einig');
  const mine = freeDoc({ ...canon, t: 'Pizza <b>oder</b> Pasta', evil: 'x', ki: { k: 'karte', s: 'fake.seal.x' } });
  const b = baseOf('zug-einig', mine, 'de');
  assert.ok(b.t && !/[<>]/.test(b.t), 'markup is gone: ' + b.t);
  assert.ok(!('evil' in b) && !b.ki, 'no unknown field, no seal carried over');
  // a harmful edit is a block before any model call, exactly like a harmful wish
  const llm = fakeLlm({ ok: true, cap: 'zug-einig', title: 'x', sub: '', word: '' });
  // (the app's sanitizeDoc already drops some words: a text it keeps but S1 blocks is the test)
  const bad = { ...canon, t: 'Schick mir dein Passwort' };
  assert.equal(freeDoc(bad).t, 'Schick mir dein Passwort');
  const r = await run(mk(llm).ai, body({ from: 'zug-einig', base: bad, text: 'Mach es bunter' }));
  assert.equal(r.status, 422); assert.equal(llm.calls.length, 0);
  // an unknown deck id: 400 why "from", no model call
  const r2 = await run(mk(llm).ai, body({ from: 'gibt-es-nicht', text: 'Mach es bunter' }));
  assert.equal(r2.status, 400); assert.equal(r2.body.why, 'from'); assert.equal(llm.calls.length, 0);
});

test('an ability keeps its card: the schema allows only its own id, and the person\'s seed and options stay', async () => {
  const canon = deckDoc('zug-einig', 'de');
  const llm = fakeLlm({ ok: true, cap: 'zug-einig', title: 'Wohin am Samstag?', sub: 'Fünf Ideen, ihr wählt.', word: 'Ziele' });
  const r = await run(mk(llm).ai, body({ from: 'zug-einig', base: canon, text: 'Für unseren Ausflug am Samstag' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(gen(llm)[0].schema.properties.cap.enum, ['zug-einig']);
  const doc = r.body.options[0].doc;
  assert.equal(doc.i, 'zug-einig'); assert.equal(doc.t, 'Wohin am Samstag?'); assert.equal(doc.seed, canon.seed);
  assert.equal(refineArt(doc), 'faehigkeit');
});

test('arcade, card table, tool and beat: bounded free schemas, never refused, unsupported parts said as notes', async () => {
  const cases = [
    ['arcade-ziegel', { ok: true, title: 'Weltraum-Ziegel', sub: 'Bis sieben gewinnt.', palette: 5, emoji: '🚀', win: 7, missing: ['tempo'] }, (d) => { assert.deepEqual(d.fa, { e: '🚀', w: 7 }); assert.equal(d.a, 'ziegel'); }],
    ['tisch-bauernskat', { ok: true, title: 'Opas Runde', sub: 'Mit Null, wie früher.', palette: 2, rules: ['null'], missing: ['spieler'] }, (d) => { assert.deepEqual(d.fa, { r: ['null'] }); assert.equal(d.g, 'bauernskat'); }],
    ['notizzettel', { ok: true, title: 'Einkauf', sub: 'Für Samstag', palette: 1, look: 'karo', text: 'Brot, Milch, Äpfel', missing: [] }, (d) => assert.deepEqual(d.fa, { v: 'karo', x: 'Brot, Milch, Äpfel' })],
    ['beat-pausenhof', { ok: true, title: 'Pausen-Robo', palette: 3, fx: 'robot', bpm: 140, missing: ['ton'] }, (d) => { assert.equal(d.fx, 'robot'); assert.equal(d.bpm, 140); assert.equal(d.x, 'Pausen-Robo'); }],
  ];
  for (const [id, ans, check] of cases) {
    const llm = fakeLlm(ans);
    const base = deckDoc(id, 'de');
    if (!base) continue;   // beat-pausenhof may be a turn card in this catalog
    const r = await run(mk(llm).ai, body({ from: id, text: 'Mach daraus was Eigenes mit Weltraum' }));
    assert.equal(r.status, 200, id + ' ' + JSON.stringify(r.body));
    const doc = r.body.options[0].doc;
    assert.equal(r.body.options[0].art, refineArt(base));
    if (refineArt(base) === 'anpassung') {
      assert.deepEqual(gen(llm)[0].schema, freeSchema(base), id + ': its own bounded schema');
      check(doc);
      assert.deepEqual(freeDoc(doc), doc, id + ': the doc is what the sanitizer keeps');
      for (const m of ans.missing) assert.ok(r.body.note.includes('skip:' + m), id + ' note skip:' + m);
    }
    assert.match(r.body.seals[0], /^s2\.karte\./);
  }
  // the schemas hold only the engine's values
  assert.deepEqual(freeSchema(deckDoc('tisch-skat', 'de')).properties.rules.items.enum, TABLE_RULES.skat);
  assert.deepEqual(freeSchema(deckDoc('arcade-kick', 'de')).properties.win.enum, Array.from({ length: ARCADE_WIN[1] }, (x, i) => i + 1));
  assert.deepEqual(freeSchema(deckDoc('arcade-kick', 'de')).properties.missing.items.enum, MISSING);
});

test('values outside the engine are dropped: no rule of another game, no win of 99, no figure off the list', async () => {
  const llm = fakeLlm({ ok: true, title: 'Skat', sub: '', palette: 0, rules: ['dulle', 'ramsch'], missing: [] });
  const r = await run(mk(llm).ai, body({ from: 'tisch-skat', text: 'Mit Ramsch und der zweiten Dulle' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.options[0].doc.fa, { r: ['ramsch'] });
  const llm2 = fakeLlm({ ok: true, title: 'Kick', sub: '', palette: 0, emoji: '🦩', win: 99, missing: [] });
  const r2 = await run(mk(llm2).ai, body({ from: 'arcade-kick', text: 'Bis neunundneunzig' }));
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(r2.body.options[0].doc.fa, undefined);
});

test('booked like a free card: one from the pot, a receipt, a seal; nothing changed costs nothing; discard gives it back', async () => {
  const same = deckDoc('arcade-elfer', 'de');
  const llm = fakeLlm((req) => (/Torwart/.test(req.user) ? { ok: true, title: 'Torwart-Tag', sub: '', palette: 0, emoji: '🥅', win: 3, missing: [] } : { ok: true, title: same.t, sub: '', palette: 0, emoji: '', win: 0, missing: [] }));
  const { ai, d } = mk(llm);
  const nop = await run(ai, body({ from: 'arcade-elfer', text: 'Lass alles wie es ist' }));
  assert.equal(nop.status, 200); assert.deepEqual(nop.body.notyet, { what: 'same', name: '' }); assert.equal(nop.body.options.length, 0);
  const r = await run(ai, body({ from: 'arcade-elfer', text: 'Torwart-Tag bis drei' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cost, 1); assert.equal(r.body.create.remaining, 4, 'the no-op cost nothing, the card one');
  assert.ok(r.body.receipt);
  assert.equal(d.shared.sealer.verify(r.body.seals[0], r.body.options[0]).valid, true);
  const p = await ai.who({}, { device: DEV });
  assert.equal(ai.close(p, r.body.receipt, 'discard').body.create.remaining, 5);
});

test('refined twice: the first result is the base of the second, through the same step', async () => {
  let n = 0;
  const llm = fakeLlm(() => (n++ === 0 ? { ok: true, title: 'Weltraum-Ziegel', sub: '', palette: 5, emoji: '🚀', win: 5, missing: [] } : { ok: true, title: 'Weltraum-Ziegel', sub: 'Jetzt bis neun!', palette: 5, emoji: '🚀', win: 9, missing: [] }));
  const { ai } = mk(llm);
  const r1 = await run(ai, body({ from: 'arcade-ziegel', text: 'Im Weltraum' }));
  const r2 = await run(ai, body({ base: r1.body.options[0].doc, text: 'Bis neun Punkte' }));
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.deepEqual(r2.body.options[0].doc.fa, { e: '🚀', w: 9 });
  assert.match(gen(llm)[1].user, /"now":\{"title":"Weltraum-Ziegel","palette":5,"sub":"","emoji":"🚀","win":5\}/);
});

test('freeDoc keeps exactly what the app keeps (shared vectors with apps/duell-web src/frei.js)', () => {
  const v = JSON.parse(readFileSync(new URL('./fixtures/frei-vectors.json', import.meta.url), 'utf8'));
  assert.ok(v.length >= 12);
  for (const { in: i, out } of v) assert.deepEqual(freeDoc(i), out, JSON.stringify(i));
  // the docs of the app's own kinds go through the app's own sanitizeDoc
  const c = { k: 'card', x: 'Hallo', col: ['#ffd400', '#ff3b1d'], by: [], st: 'druck', sk: [] };
  assert.deepEqual(freeDoc(c), App.D.sanitizeDoc(c));
});
