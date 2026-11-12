// lib/vendor/mdi is the new app's own code (bin/vendor-mdi.mjs): pinned to PROVENANCE.json, complete, free of browser APIs,
// and, with MDI_SRC pointing at apps/mdi/src of a checkout (CI job vendor-drift), equal to the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { DIR, MODULES, REPO, bundleHash, closureOf, freeCards, indexSource } from '../bin/vendor-mdi.mjs';
import { gateHash, gateView as serverGateView } from '../lib/duell-deck.mjs';
import { gateView as appGateView } from '../lib/vendor/mdi/index.js';

const PROV = JSON.parse(readFileSync(join(DIR, 'PROVENANCE.json'), 'utf8'));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

test('vendor mdi: PROVENANCE names the repo, an exact commit, the tracked branch and the bundle hash', () => {
  assert.equal(PROV.repo, REPO); assert.equal(PROV.path, 'apps/mdi/src');
  assert.match(PROV.commit, /^[0-9a-f]{40}$/); assert.match(PROV.track, /^[A-Za-z0-9._/-]+$/);
  assert.deepEqual(PROV.modules, MODULES);
  for (const id of ['frei', 'flug', 'lauf', 'zug-abfragen']) assert.ok(PROV.cards.includes(id), id);
  assert.equal(PROV.bundle, bundleHash(PROV.files));
});

test('vendor mdi: every file matches its sha256, nothing is missing, nothing extra, index.js is the generated one', () => {
  for (const [rel, h] of Object.entries(PROV.files)) assert.equal(sha(join(DIR, rel)), h, `${rel} differs from PROVENANCE.json (edited by hand? re-run bin/vendor-mdi.mjs)`);
  const onDisk = walk(DIR).map((f) => relative(DIR, f).split('\\').join('/')).filter((f) => f !== 'PROVENANCE.json').sort();
  assert.deepEqual(onDisk, Object.keys(PROV.files).sort(), 'unlisted or missing vendored file');
  // the copy is self-contained: the closure of its entries is exactly what was copied
  assert.deepEqual(closureOf(DIR, [...PROV.cards.map((id) => `cards/${id}/card.js`), ...PROV.modules]), Object.keys(PROV.files).filter((f) => f !== 'index.js').sort());
  assert.equal(readFileSync(join(DIR, 'index.js'), 'utf8'), indexSource(PROV.cards));
});

test('vendor mdi: loads and converts with DOM, network, clock, storage and timers booby-trapped', () => {
  // a fresh process: every browser global throws when touched; then each card converts its default parameters
  const trap = ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'WebSocket', 'requestAnimationFrame', 'setTimeout', 'setInterval', 'performance', 'crypto', 'atob', 'btoa'];
  const code = `for (const g of ${JSON.stringify(trap)}) Object.defineProperty(globalThis, g, { get() { throw new Error('browser API touched: ' + g); }, configurable: true });
    const V = await import(${JSON.stringify(new URL('../lib/vendor/mdi/index.js', import.meta.url).href)});
    let n = 0;
    for (const [id, c] of Object.entries(V.CARDS)) {
      const p = {}; for (const [k, v] of Object.entries(c.manifest.params.properties)) p[k] = JSON.parse(JSON.stringify(v.default));
      const d = c.toFree(p); if (d) { V.gateView(d); V.gateChecksOf(d); } n++;
    }
    console.log(n);`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim();
  assert.equal(Number(out), PROV.cards.length);
});

// The gate projection exists twice today: the server's (lib/duell-deck.mjs, it hashes what it stores) and the app's (vendored).
// For every kind the app makes they must agree byte for byte; the server's extra kind "bau" (Genre G3 Baukasten) is not in
// the app yet. When the app learns it, this test fails on purpose: then lib/duell-deck.mjs takes gateView from lib/vendor/mdi.
test('vendor mdi: the app\'s gateView equals the server\'s for every kind the app makes; "bau" is the known gap', () => {
  const docs = JSON.parse(readFileSync(new URL('./fixtures/mdi-frei-docs.json', import.meta.url), 'utf8')).docs;
  for (const [n, { doc, ki }] of Object.entries(docs)) assert.deepEqual(appGateView({ ...doc, ki }), serverGateView({ ...doc, ki }), n);
  const bau = { k: 'bau', t: 'Turm', col: ['#ffd400', '#ff3b1d'], b: { regeln: ['stapeln'] } };
  assert.notDeepEqual(appGateView(bau), serverGateView(bau), 'the app learned "bau": switch lib/duell-deck.mjs to the vendored gateView');
  assert.ok(gateHash(bau));
});

const SRC = process.env.MDI_SRC;
test('vendor mdi: no drift from the app (MDI_SRC = apps/mdi/src of a checkout)', { skip: !SRC && 'MDI_SRC not set (CI job vendor-drift sets it)' }, async () => {
  assert.ok(existsSync(join(SRC, 'cards')), 'MDI_SRC must point at apps/mdi/src');
  const cards = await freeCards(SRC);
  assert.deepEqual(cards, PROV.cards, 'the set of cards with toFree changed: re-run bin/vendor-mdi.mjs');
  const list = closureOf(SRC, [...cards.map((id) => `cards/${id}/card.js`), ...MODULES]);
  const drift = [];
  for (const rel of new Set([...list, ...Object.keys(PROV.files).filter((f) => f !== 'index.js')])) {
    if (!list.includes(rel)) drift.push(`- ${rel} (no longer needed)`);
    else if (!PROV.files[rel]) drift.push(`+ ${rel} (new)`);
    else if (sha(join(SRC, rel)) !== PROV.files[rel]) drift.push(`~ ${rel}`);
  }
  assert.deepEqual(drift, [], `lib/vendor/mdi drifted from the app (vendored ${PROV.commit.slice(0, 12)}): re-run node bin/vendor-mdi.mjs <checkout>/apps/mdi/src`);
});
