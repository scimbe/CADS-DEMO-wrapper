// The frozen regression set of the classifier S2/S4 (test/fixtures/mod-regression.json, bin/duell-mod-regression.mjs): its
// hash, its shape and the two false positives of B's v3 measurement. The live run is bin/duell-mod-regression.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MOD_SYSTEM } from '../lib/duell-karte.mjs';

const RAW = readFileSync(new URL('./fixtures/mod-regression.json', import.meta.url));
const SET = JSON.parse(RAW);

test('Regressionsmenge S2/S4 ist eingefroren (Hash) und vollstaendig', () => {
  assert.equal(createHash('sha256').update(RAW).digest('hex'), '93bce5ae0bed8cec8873c0711deee29d118b8e8cedb174766f4e9b7acd40f6ac', 'Gold eingefroren: Aenderung nur mit neuem Hash und Begruendung im PR');
  const ids = new Set(SET.eintraege.map((e) => e.id));
  assert.equal(ids.size, SET.eintraege.length, 'ids eindeutig');
  for (const e of SET.eintraege) {
    assert.ok(['REQUEST', 'CARD'].includes(e.was), e.id); assert.ok(['kein-strike', 'strike'].includes(e.soll), e.id);
    assert.equal(typeof e.text, 'string'); assert.ok(e.text.length > 0 && e.text.length < 600, e.id); assert.ok(e.quelle, e.id);
  }
  for (const id of ['fp-v040', 'fp-v066', 'r-v040', 'r-v066']) assert.equal(SET.eintraege.find((e) => e.id === id).soll, 'kein-strike', id);
  const n = (was, soll) => SET.eintraege.filter((e) => e.was === was && e.soll === soll).length;
  assert.ok(n('REQUEST', 'strike') >= 10 && n('CARD', 'strike') >= 10, 'beide Seiten: was blockiert werden muss');
  assert.ok(n('REQUEST', 'kein-strike') >= 100 && n('CARD', 'kein-strike') >= 100, 'und was nicht blockiert werden darf');
});

test('MOD_SYSTEM nennt Gattungsbegriffe als Nicht-Marke und Spielmechanik als Nicht-other, mit beiden Falsch-Positiv-Beispielen', () => {
  const mod = MOD_SYSTEM.map((b) => b.text).join('\n');
  assert.match(mod, /Common nouns are never a brand/); assert.match(mod, /A game mechanic is never "other"/);
  assert.match(mod, /Robot Puddle Jump/); assert.match(mod, /den anderen Autos ausweichen/);
});
