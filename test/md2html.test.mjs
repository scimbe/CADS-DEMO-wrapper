import test from 'node:test';
import assert from 'node:assert/strict';
import { md2html } from '../lib/md2html.mjs';

test('bold, h3 and lists render; no raw markers remain', () => {
  const h = md2html('# Titel\n\n### Mieter\n\n**Alt:** 800 EUR\n\n- erster Punkt\n- **zweiter** Punkt\n\n## Ende\n');
  assert.match(h, /<h3>Mieter<\/h3>/);
  assert.match(h, /<strong>Alt:<\/strong> 800 EUR/);
  assert.match(h, /<ul><li>erster Punkt<\/li><li><strong>zweiter<\/strong> Punkt<\/li><\/ul>/);
  const body = h.slice(h.indexOf('</style>'));
  assert.ok(!/\*\*|###/.test(body));
});
test('html in the markdown is escaped', () => {
  assert.ok(md2html('**<script>x</script>**').includes('&lt;script&gt;'));
});
test('diff blocks still render', () => {
  assert.match(md2html('```diff\n-a\n+b\n```'), /dl del[\s\S]*dl add/);
});
