import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UI, makeT, clientStrings, normLang, tr, di } from '../lib/i18n.mjs';

const DEMOS = JSON.parse(readFileSync(new URL('../demos.json', import.meta.url), 'utf8'));
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('DE and EN dictionaries have exactly the same keys', () => {
  const de = Object.keys(UI.de).sort(), en = Object.keys(UI.en).sort();
  assert.deepEqual(en.filter((k) => !(k in UI.de)), [], 'keys only in EN');
  assert.deepEqual(de.filter((k) => !(k in UI.en)), [], 'keys only in DE');
});

test('no empty strings, and EN really differs from DE (no untranslated copy)', () => {
  // identical strings are fine for numbers/brand-only values; flag anything with letters
  const allowed = new Set(['crumb.demos', 'status.parallel', 'pb.optional']);
  for (const k of Object.keys(UI.de)) {
    assert.ok(UI.de[k].trim() && UI.en[k].trim(), `${k}: empty`);
    if (!allowed.has(k)) assert.notEqual(UI.en[k], UI.de[k], `${k}: EN is identical to DE`);
  }
});

test('{placeholders} match between DE and EN for every key', () => {
  for (const k of Object.keys(UI.de)) assert.equal(placeholders(UI.en[k]), placeholders(UI.de[k]), k);
});

test('makeT fills placeholders and falls back to German, then to the key', () => {
  assert.equal(makeT('en')('search.count', { shown: 2, total: 9 }), '2 of 9');
  assert.equal(makeT('de')('search.count', { shown: 2, total: 9 }), '2 von 9');
  assert.equal(makeT('xx')('a11y.skip'), UI.de['a11y.skip']);
  assert.equal(makeT('en')('does.not.exist'), 'does.not.exist');
});

test('normLang / tr / di keep the existing mechanism intact', () => {
  assert.equal(normLang('en'), 'en');
  assert.equal(normLang('fr'), 'de');
  assert.equal(normLang(null), 'de');
  assert.equal(tr('en')('Hallo', 'Hello'), 'Hello');
  assert.equal(tr('en')('Hallo'), 'Hallo');
  assert.equal(di({ a: 'x', a_en: 'y' }, 'a', 'en'), 'y');
  assert.equal(di({ a: 'x' }, 'a', 'en'), 'x');
});

test('clientStrings ships the js.*, status.* and search.* keys in the requested language', () => {
  const en = clientStrings('en'), de = clientStrings('de');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(de).sort());
  assert.equal(en['js.run.retry'], 'Try again');
  assert.equal(de['js.run.retry'], 'Erneut versuchen');
  assert.ok(Object.keys(en).every((k) => /^(js|status|search|pb|inst)\./.test(k)));
});

test('every demo has a German and an English card text (title, blurb, tech, category)', () => {
  for (const [slug, d] of Object.entries(DEMOS)) {
    for (const f of ['title', 'blurb', 'tech', 'category']) {
      assert.ok(d[f] && String(d[f]).trim(), `${slug}.${f} missing`);
      assert.ok(d[f + '_en'] && String(d[f + '_en']).trim(), `${slug}.${f}_en missing`);
    }
  }
});
