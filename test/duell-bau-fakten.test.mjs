// Fact check of quiz games (lib/duell-bau-fakten.mjs): modes aus | vorschlag | aktiv, never a silent change. Model is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { REASONS } from '../lib/duell-bau.mjs';
import { MOD_SYSTEM } from '../lib/duell-karte.mjs';
import { FAKTEN_SYSTEM, FAKTEN_SCHEMA, fragenOf, pruefeFakten } from '../lib/duell-bau-fakten.mjs';
import { BEISPIELE } from '../lib/vendor/mdi-baukasten/engines/baukasten/beispiele.js';
import { check } from '../lib/vendor/mdi-baukasten/engines/baukasten/check.js';
import { normalize } from '../lib/vendor/mdi-baukasten/engines/baukasten/spec.js';

const DEV = 'd'.repeat(32), QUIZ = { ok: true, ...check(BEISPIELE.quiz).desc };
// verdict(fragen, call#) -> items; the card answers QUIZ
function fakeLlm(verdict) {
  const calls = []; let n = 0;
  return { calls, configured: true, async generate(req) {
    calls.push(req);
    if (req.system === MOD_SYSTEM) return { json: { risk: 0, cats: [], drink: 'none', takt: 'zug' }, stop: 'end_turn', usage: {} };
    if (req.system === FAKTEN_SYSTEM) { const f = JSON.parse(req.user.slice(6, -7)); assert.ok(f.every((x) => x.art === "auswahl")); return { json: { items: verdict(f, n++) }, stop: 'end_turn', usage: {} }; }
    return { json: QUIZ, stop: 'end_turn', usage: {} };
  } };
}
function mk(llm, fakten) {
  const d = createDuell({ env: { DUELL_DAILY_MAX: '200', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: async () => '{}' });
  d.shared.age16 = () => true; d.shared.age18 = () => false;
  return createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0', ...(fakten ? { DUELL_BAU_FAKTEN: fakten } : {}) }, llm: async () => '{}', cardLlm: llm, shared: d.shared, auth: { mode: 'gate', identify: async () => ({ email: 'lea@example.org' }) }, log: () => {} });
}
const run = async (ai) => { const b = { kind: 'karte', input: { text: 'Weltraum-Quiz', art: 'game', genre: 'G3' }, device: DEV, lang: 'de' }; return ai.act(b, await ai.who({}, b), null); };
const sicher = (f) => f.map((x) => ({ i: x.i, urteil: 'sicher', grund: '', besser: '' }));
const eineFalsch = (f) => f.map((x) => ({ i: x.i, urteil: x.i === 0 ? 'falsch' : 'sicher', grund: x.i === 0 ? 'stimmt nicht' : '', besser: '' }));
const questions = (r) => normalize(r.body.options[0].doc.b).desc.turn.items.length;

test('Fakten: Schema fest, Fragen nur bei Antwortspielen, keine Antwort des Pruefers = unsicher (fail closed)', async () => {
  assert.deepEqual(FAKTEN_SCHEMA.properties.items.items.properties.urteil.enum, ['sicher', 'unsicher', 'falsch']);
  assert.equal(fragenOf(check(BEISPIELE.memory).desc).length, 0); assert.equal(fragenOf(check(BEISPIELE.quiz).desc).length, 4);
  const r = await pruefeFakten({ generate: async () => ({ json: null }) }, null, fragenOf(check(BEISPIELE.quiz).desc));
  assert.equal(r.ok, false); assert.ok(r.urteile.every((u) => u.urteil === 'unsicher'));
  assert.ok(!/volcano|vulkan|snowboard/i.test(FAKTEN_SYSTEM[0].text), 'keine Kalibrierfragen als Beispiel im Praefix');
});

test('Fakten vorschlag (Standard): Spiel unveraendert, Markierung als Hinweis und im Ergebnis', async () => {
  const llm = fakeLlm(eineFalsch), r = await run(mk(llm));
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(questions(r), 4);
  assert.ok(r.body.note.includes('bau:fakten-vorschlag:1'));
  assert.equal(llm.calls.filter((c) => c.system === FAKTEN_SYSTEM).length, 1);
});

test('Fakten aktiv: markierte Frage geht als Reparaturgrund zurueck; bleibt sie markiert, wird sie offen entfernt', async () => {
  let llm = fakeLlm((f, n) => (n === 0 ? eineFalsch(f) : sicher(f))), r = await run(mk(llm, 'aktiv'));
  assert.equal(r.status, 200); assert.equal(questions(r), 4); assert.ok(r.body.note.includes('bau:repariert'));
  assert.match(llm.calls.filter((c) => /card_bau_zug/.test(c.name))[1].user, /uncertain or wrong facts/);
  llm = fakeLlm(eineFalsch); r = await run(mk(llm, 'aktiv'));
  assert.equal(r.status, 200); assert.equal(questions(r), 3); assert.ok(r.body.note.includes('bau:fakten-entfernt:1'));
  llm = fakeLlm((f) => f.map((x) => ({ i: x.i, urteil: 'unsicher', grund: 'unklar', besser: '' }))); r = await run(mk(llm, 'aktiv'));
  assert.equal(r.body.reason, 'bau_fakten', 'weniger als 3 sichere Fragen: ehrliche Absage'); assert.ok(REASONS.includes(r.body.notyet.name)); assert.ok(r.body.alt);
});

test('Fakten aus: kein Pruefaufruf', async () => {
  const llm = fakeLlm(eineFalsch), r = await run(mk(llm, 'aus'));
  assert.equal(r.status, 200); assert.equal(llm.calls.filter((c) => c.system === FAKTEN_SYSTEM).length, 0);
});

test('Kalibrierung: CSV lesen, unbewertete Zeilen werden abgelehnt, Kennzahlen stimmen', async () => {
  const { leseCsv, vergleiche } = await import('../lib/duell-bau-fakten.mjs');
  const { cohenKappa } = await import('../lib/duell-bau-gold.mjs');
  const csv = 'nr;frage;urteil (sicher|unsicher|falsch);grund;bewertet_von\n"f01";"A; mit ""Zitat""";"falsch";"x";"Lea"\n"f02";"B";"sicher";"";"Lea"\n"f03";"C";"unsicher";"";"Lea"\n"f04";"D";"sicher";"";"Lea"\n';
  const m = leseCsv(csv);
  assert.equal(m.length, 4); assert.equal(m[0].frage, 'A; mit "Zitat"'); assert.equal(m[0].urteil, 'falsch');
  const v = vergleiche(m, [{ nr: 'f01', urteil: 'falsch' }, { nr: 'f02', urteil: 'unsicher' }, { nr: 'f03', urteil: 'sicher' }, { nr: 'f04', urteil: 'sicher' }], cohenKappa);
  assert.equal(v.gleich, 0.5); assert.equal(v.recall, 0.5); assert.equal(v.precision, 0.5); assert.equal(v.recallFalsch, 1); assert.equal(v.uneinig.length, 2);
  assert.throws(() => vergleiche([{ nr: 'f01', urteil: '' }], [], cohenKappa), /nicht bewertet/);
});
