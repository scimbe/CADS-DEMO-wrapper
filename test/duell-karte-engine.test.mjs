// The free card's game matching (lib/duell-karte.mjs engineOf, engineFits): a wish for a runner, jump'n'run or platformer
// goes to the second engine (art lauf, the app's src/lauf.js and src/lauf-engine.js, vendored) and never comes back as the
// flying game; flying stays flying; a named game no engine makes is honestly "not yet". User report 10.11.2026:
// "Endless Runner über Brücken" became the flying game with outcome "ok".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { App, Lauf, ARTS, CARD_SYSTEM, MOD_SYSTEM, SCHEMAS, compose, engineOf, engineFits, fits } from '../lib/duell-karte.mjs';
import { ABSAGE, gameKeyOf } from '../lib/duell-absage.mjs';

const GOLD = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/karte-engine-golden.json', import.meta.url)), 'utf8'));
const DEV = 'c'.repeat(32);
// a fake model: the classifier says harmless, the card call answers by its schema (a flying game, a runner)
const FLY = { ok: true, title: 'Eisflug', emoji: SCHEMAS.game.properties.emoji.enum[0], theme: 'day', motif: 'none', level: 'normal', route: [0, 1, 2].map(() => ({ physik: 'normal', thema: 'day', emoji: SCHEMAS.game.properties.emoji.enum[0] })) };
const RUN = { ok: true, title: 'Brückenlauf', mode: 'endlos', world: 'bruecke', level: 'normal', figure: '🦊', obstacle: '📦', coin: '🪙', foe: '🐦', has: ['luecken', 'hindernisse', 'muenzen'], foes: ['geh'] };
function fakeLlm(answer) {
  const calls = [];
  return {
    calls, configured: true,
    async generate(req) {
      calls.push(req);
      if (req.system === MOD_SYSTEM) return { json: { risk: 0, cats: [] }, stop: 'end_turn', usage: { in: 10, out: 8 } };
      return { json: answer(req), stop: 'end_turn', usage: { in: 40, out: 60 } };
    },
  };
}
function mk(cardLlm) {
  const d = createDuell({ env: { DUELL_DAILY_MAX: '200', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: async () => '{}' });
  d.shared.age16 = () => true; d.shared.age18 = () => false;
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: async () => '{}', cardLlm, shared: d.shared, auth: { mode: 'gate', identify: async () => ({ email: 'lea@example.org' }) }, log: () => {} });
  return { d, ai };
}
const body = (text, art = 'game') => ({ kind: 'karte', input: { text, art }, device: DEV, lang: 'de' });
const run = async (ai, b) => ai.act(b, await ai.who({}, b), null);
// the model answers by the schema it was given, as structured outputs force it to
const bySchema = (req) => (req.schema === SCHEMAS.lauf ? RUN : FLY);

test('Golden-Satz: jeder Spielwunsch landet in der richtigen Engine (Runner, Jump\'n\'Run, Plattformer, Flug, noch nicht)', () => {
  assert.ok(GOLD.wishes.length >= 10);
  const got = GOLD.wishes.map(([w]) => { const e = engineOf(w); return typeof e === 'string' ? e : 'notyet:' + e.notyet; });
  assert.deepEqual(got, GOLD.wishes.map(([, want]) => want));
  for (const k of ['lauf', 'flug']) assert.ok(GOLD.wishes.filter(([, x]) => x === k).length >= 4, k);
});

test('"Endless Runner über Brücken" mit Art Spiel: eine Lauf-Karte ueber Bruecken aus dem Lauf-Schema, versiegelt, die App aendert nichts', async () => {
  const llm = fakeLlm(bySchema), { ai, d } = mk(llm);
  const r = await run(ai, body('Endless Runner über Brücken'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [opt] = r.body.options, gen = llm.calls.find((c) => c.system === CARD_SYSTEM);
  assert.equal(opt.art, 'lauf'); assert.equal(opt.doc.k, 'lauf');
  assert.equal(gen.schema, SCHEMAS.lauf); assert.match(gen.user, /^Card type: lauf\./);
  assert.equal(opt.doc.l.m, 'endlos'); assert.equal(opt.doc.l.w, 'bruecke'); assert.ok(opt.doc.l.p.lu >= 45, 'Bruecken mit Luecken');
  assert.deepEqual(App.D.sanitizeDoc(opt.doc), opt.doc); assert.ok(fits(opt.doc));
  assert.equal(d.shared.sealer.verify(r.body.seals[0], opt).valid, true);
});

test('Ein Runner-Wunsch geht nie als Flieger durch: Routing vor dem Modell und Typ-Pruefung danach; Flug bleibt Flug', async () => {
  for (const [w, want] of GOLD.wishes.filter(([, x]) => x === 'lauf' || x === 'flug')) {
    // even a model that answers with a flying game whatever it is asked never brings a flying game for a runner wish
    for (const answer of [bySchema, () => FLY]) {
      const llm = fakeLlm(answer), { ai } = mk(llm);
      const r = await run(ai, body(w));
      const k = r.body.options && r.body.options[0] && r.body.options[0].doc.k;
      if (want === 'lauf') assert.notEqual(k, 'game', w);
      if (want === 'lauf' && answer === bySchema) assert.equal(k, 'lauf', w);
      if (want === 'flug') assert.equal(k, 'game', w);
    }
  }
  const gameDoc = { k: 'game' }, laufDoc = { k: 'lauf' };
  assert.equal(engineFits(gameDoc, 'Endless Runner über Brücken'), false);
  assert.equal(engineFits(laufDoc, 'Ein Drache fliegt durch die Nacht'), false);
  assert.equal(engineFits(laufDoc, 'Jump and Run im Wald'), true);
});

test('Kein passendes Spiel: ehrlich noch nicht, ohne Modellaufruf und ohne Buchung', async () => {
  for (const [w, want] of GOLD.wishes.filter(([, x]) => x.startsWith('notyet:'))) {
    const llm = fakeLlm(bySchema), { ai } = mk(llm);
    const r = await run(ai, body(w)), key = gameKeyOf(w);
    // a game the refusal table knows (lib/duell-absage.mjs, W111f) gets its fixed answer first; any other the engine's
    if (key) { assert.equal(r.body.notyet, true, w); assert.equal(r.body.reason, key, w); assert.deepEqual(r.body.alt, ABSAGE[key].alt, w); }
    else assert.deepEqual(r.body.notyet, { what: 'game', name: want.slice(7) }, w);
    assert.equal(llm.calls.length, 0, w); assert.equal(r.body.receipt, undefined, w);
  }
});

test('Schema und Beispiele der Art lauf: geschlossen, nur Listenwerte, Beispiele im gecachten Praefix passen zum Schema', () => {
  assert.ok(ARTS.includes('lauf'));
  const S = SCHEMAS.lauf;
  assert.equal(S.additionalProperties, false); assert.deepEqual([...S.required].sort(), Object.keys(S.properties).sort());
  assert.deepEqual(S.properties.figure.enum, Lauf.L.FIG); assert.deepEqual(S.properties.world.enum, Lauf.L.WORLDS);
  const cached = CARD_SYSTEM.find((b) => b.cache).text, ex = [...cached.matchAll(/Card type: lauf\..*\n(\{.*\})/g)].map((m) => JSON.parse(m[1]));
  assert.ok(ex.length >= 2 && ex.some((e) => e.world === 'bruecke' && e.mode === 'endlos'));
  for (const e of ex) {
    assert.deepEqual(Object.keys(e).sort(), [...S.required].sort());
    for (const [k, v] of Object.entries(e)) if (S.properties[k].enum) assert.ok(S.properties[k].enum.includes(v), k);
    const doc = compose('lauf', e, 7, (v, max) => String(v || '').slice(0, max));
    assert.equal(doc.k, 'lauf'); assert.ok(fits(doc));
  }
  // the numbers are the server's: whatever the model sends beyond the schema, the level picks them
  assert.deepEqual(compose('lauf', { ...RUN, p: { g: 1 } }, 7, (v) => String(v)).l.p, compose('lauf', RUN, 7, (v) => String(v)).l.p);
});
