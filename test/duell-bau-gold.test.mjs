// The frozen gold corpus of G3 (test/fixtures/bau-gold.json) and its executable scoring (lib/duell-bau-gold.mjs). The corpus
// was written by hand before the first model run and is pinned by its hash: an edit is a new corpus version, never a tuning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { merkmalOk, bewerte, zusammenfassung } from '../lib/duell-bau-gold.mjs';
import { BEISPIELE } from '../lib/vendor/mdi-baukasten/engines/baukasten/beispiele.js';
import { check } from '../lib/vendor/mdi-baukasten/engines/baukasten/check.js';
import { compact } from '../lib/vendor/mdi-baukasten/engines/baukasten/spec.js';

const RAW = readFileSync(new URL('./fixtures/bau-gold.json', import.meta.url));
const K = JSON.parse(RAW);
export const GOLD_SHA = '2462e3c82c2db5d48c3af67b8bf161e4d061fa63bd2023a6e39d9e6ea51af70c';

test('Gold G3: eingefroren (SHA-256), mindestens 40 Saetze, Dev/Test getrennt, beide Ergebnisarten', () => {
  assert.equal(createHash('sha256').update(RAW).digest('hex'), GOLD_SHA, 'Korpus geaendert: neue Version anlegen statt bearbeiten');
  assert.equal(typeof K.herkunft, 'string');
  assert.ok(K.eintraege.length >= 40);
  assert.equal(new Set(K.eintraege.map((e) => e.id)).size, K.eintraege.length);
  for (const s of ['dev', 'test']) assert.ok(K.eintraege.filter((e) => e.split === s).length >= 20, s);
  const spiel = K.eintraege.filter((e) => e.erwartet.ergebnis === 'spiel');
  assert.ok(spiel.length >= 30 && K.eintraege.length - spiel.length >= 10);
  assert.ok(spiel.some((e) => e.erwartet.takt === 'zug') && spiel.some((e) => e.erwartet.takt === 'echtzeit'));
  assert.ok(K.eintraege.some((e) => e.lang === 'en'));
});

test('Gold G3: jedes Merkmal ist eine bekannte, ausfuehrbare Pruefung', () => {
  const d = check(BEISPIELE.flappy).desc;
  for (const e of K.eintraege.filter((x) => x.erwartet.ergebnis === 'spiel')) for (const m of e.erwartet.merkmale) {
    assert.doesNotThrow(() => merkmalOk(d, m), e.id + ' ' + m);
    assert.ok(Object.keys(K.merkmale_doku).some((k) => k.split(':')[0] === m.split(':')[0]), m);
  }
});

test('Gold G3: Bewertung erkennt passendes Spiel, falschen Takt, fehlende Merkmale, Absage und Block', () => {
  const ok = (ex) => ({ options: [{ art: 'game', doc: { k: 'bau', t: 'x', b: compact(check(BEISPIELE[ex]).desc) } }] });
  const flug = { erwartet: { ergebnis: 'spiel', takt: 'echtzeit', merkmale: ['control:flap', 'gravity', 'spawn'] } };
  assert.equal(bewerte(flug, 200, ok('flappy')).passt, true);
  const memo = { erwartet: { ergebnis: 'spiel', takt: 'zug', merkmale: ['turn:flip'] } };
  assert.equal(bewerte(memo, 200, ok('flappy')).taktOk, false);
  assert.equal(bewerte({ erwartet: { ergebnis: 'spiel', takt: 'echtzeit', merkmale: ['control:jump'] } }, 200, ok('flappy')).passt, false);
  assert.equal(bewerte(memo, 200, ok('memory')).passt, true);
  assert.equal(bewerte({ erwartet: { ergebnis: 'absage' } }, 200, { notyet: { what: 'game' } }).ok, true);
  assert.equal(bewerte({ erwartet: { ergebnis: 'block' } }, 422, { error: 'blocked' }).ok, true);
  assert.equal(bewerte({ erwartet: { ergebnis: 'absage' } }, 200, ok('flappy')).ok, false);
  const rows = [{ id: 'a', split: 'dev', erwartet: flug.erwartet, bewertung: bewerte(flug, 200, ok('flappy')) }, { id: 'b', split: 'test', erwartet: { ergebnis: 'absage' }, bewertung: bewerte({ erwartet: { ergebnis: 'absage' } }, 200, { notyet: {} }) }];
  const s = zusammenfassung(rows);
  assert.equal(s.spielbar, 1); assert.equal(s.passt, 1); assert.equal(s.absageRichtig, 1);
});

test('Gold G3: Cohen-Kappa und Spieltext fuer den zweiten Bewerter', async () => {
  const { cohenKappa, spielText } = await import('../lib/duell-bau-gold.mjs');
  assert.deepEqual(cohenKappa([true, true, false, false], [true, true, false, false]).kappa, 1);
  const k = cohenKappa([true, true, true, false, false, true, true, false, true, true], [true, true, false, false, true, true, true, false, true, true]);
  assert.ok(Math.abs(k.agree - 0.8) < 1e-9 && Math.abs(k.kappa - (0.8 - 0.58) / 0.42) < 1e-9, JSON.stringify(k));
  const t = spielText(compact(check(BEISPIELE.flappy).desc));
  assert.match(t, /Wolkenflug/); assert.match(t, /Steuerung flap/); assert.match(t, /15 Punkte/);
  assert.match(spielText(compact(check(BEISPIELE.memory).desc)), /Memory mit 8 Paaren/);
});

test('Gold G3 v2: unabhaengig geschrieben und vor dem Tuning eingefroren; >= 100 Spielsaetze; Dev-Korpus getrennt', () => {
  const raw = readFileSync(new URL('./fixtures/bau-gold-v2.json', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), 'dec92dcfea49ad9ac409f2fb989b72fcc6caa1478df6aa61f141ce91caac4de0', 'v2 geaendert: neue Version anlegen');
  const v2 = JSON.parse(raw), d = check(BEISPIELE.flappy).desc;
  assert.ok(v2.eintraege.filter((e) => e.erwartet.ergebnis === 'spiel').length >= 100);
  assert.ok(v2.eintraege.every((e) => e.split === 'test2'));
  for (const e of v2.eintraege) if (e.erwartet.ergebnis === 'spiel') for (const m of e.erwartet.merkmale) assert.doesNotThrow(() => merkmalOk(d, m), e.id + ' ' + m);
  const dev = JSON.parse(readFileSync(new URL('./fixtures/bau-dev.json', import.meta.url), 'utf8'));
  assert.ok(dev.eintraege.every((e) => e.split === 'dev'));
  const s2 = new Set(v2.eintraege.map((e) => e.satz.toLowerCase()));
  assert.ok(!dev.eintraege.some((e) => s2.has(e.satz.toLowerCase())), 'kein Satz in Dev und Test zugleich');
});
