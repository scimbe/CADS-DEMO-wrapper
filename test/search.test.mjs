import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSearchBlob, flattenText, normalizeSearchText } from '../lib/search.mjs';

const DEMOS = JSON.parse(readFileSync(new URL('../demos.json', import.meta.url), 'utf8'));

test('flattenText walks nested values and never stringifies an object', () => {
  const out = flattenText({ a: 'x', b: [1, { c: 'y' }], d: null, e: false });
  assert.deepEqual(out, ['x', '1', 'y']);
  assert.ok(!out.join(' ').includes('[object Object]'));
});

test('flattenText skips model instructions and schema plumbing', () => {
  const out = flattenText({ system: 'geheimer System-Prompt', type: 'enum', min: 1, max: 5, examples: ['als Graphviz'] });
  assert.deepEqual(out, ['als Graphviz']);
});

test('regression: a demo_prompt object does not leak "[object Object]" into the blob', () => {
  const d = {
    title: 'Diagramm aus Text',
    demo_prompt: { system: 'SECRET', parameters: [{ name: 'engine', type: 'enum', options: ['mermaid', 'graphviz'] }], examples: ['als Graphviz'] },
  };
  const blob = buildSearchBlob('diagram', d, 'Grafik');
  assert.ok(!blob.includes('[object object]'), blob);
  assert.ok(!blob.includes('object'), blob);
  assert.ok(blob.includes('graphviz'));
  assert.ok(blob.includes('als graphviz'));
  assert.ok(!blob.includes('secret'), 'model instructions are not searchable');
});

test('blob is lower-case, attribute-safe and contains DE and EN text', () => {
  const d = { title: 'Verträge <b>vergleichen</b> & "prüfen"', title_en: 'Compare contracts', blurb: 'Q&amp;A `code`' };
  const blob = buildSearchBlob('contractcheck', d, 'Dokumente');
  assert.equal(blob, blob.toLowerCase());
  assert.ok(!/[<>"&`]/.test(blob), blob);
  assert.ok(blob.includes('verträge vergleichen'));
  assert.ok(blob.includes('compare contracts'));
  assert.ok(blob.includes('q a code'), blob);
});

test('normalizeSearchText strips tags and entities', () => {
  assert.equal(normalizeSearchText('<p>Foto&amp;Video</p>'), 'foto video');
});

test('every real demo yields a clean, non-empty blob', () => {
  for (const [slug, d] of Object.entries(DEMOS)) {
    const blob = buildSearchBlob(slug, d, d.category);
    assert.ok(blob.length > 20, `${slug}: blob too short`);
    assert.ok(!blob.includes('[object'), `${slug}: contains [object …]`);
    assert.ok(blob.includes(slug.toLowerCase()), `${slug}: slug not searchable`);
  }
});

test('the 8 demos that carry a demo_prompt object are the ones that used to break', () => {
  const withPrompt = Object.entries(DEMOS).filter(([, d]) => d.demo_prompt && typeof d.demo_prompt === 'object');
  assert.ok(withPrompt.length >= 7, `expected >= 7 demos with a demo_prompt object, got ${withPrompt.length}`);
  for (const [slug, d] of withPrompt) assert.ok(!buildSearchBlob(slug, d, '').includes('[object'), slug);
});
