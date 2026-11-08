// The checked-in game page (apps/duell-web/dist/): a page built with parts names them in its manifest
// (window.DailyParts = {name: {f, h, d}}), and each one must lie next to it with that SRI hash. Copying only index.html
// on an update would leave the web without arcade/live, the card table, the QR picture and the licences; this fails first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'duell-web', 'dist');

/** What is wrong with the page in dir and its parts; [] when nothing. A page without the parts loader needs no parts. */
function distProblems(dir) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  if (!html.includes('DailyParts')) return [];
  const m = html.match(/window\.DailyParts=(\{.*?\});/);
  if (!m) return ['index.html loads parts but has no manifest'];
  const out = [], man = JSON.parse(m[1]);
  for (const [name, p] of Object.entries(man)) {
    if (!/^parts\/[a-z]{1,20}\.[0-9a-f]{12}\.js$/.test(p.f)) { out.push(name + ': file name ' + p.f + ' is not served by /duell/parts/'); continue; }
    const f = join(dir, p.f);
    if (!existsSync(f)) { out.push(name + ': ' + p.f + ' missing'); continue; }
    const h = 'sha384-' + createHash('sha384').update(readFileSync(f)).digest('base64');
    if (h !== p.h) out.push(name + ': ' + p.f + ' does not match its SRI hash');
    for (const d of p.d || []) if (!man[d]) out.push(name + ': depends on unknown part ' + d);
  }
  return out;
}

test('dist: the checked-in game page has every part it names, each with its SRI hash', () => {
  assert.deepEqual(distProblems(DIST), []);
});

test('dist/business (Daily Business at /duell/business/), when present: every part it names, each with its SRI hash', () => {
  const biz = join(DIST, 'business');
  if (!existsSync(join(biz, 'index.html'))) return;   // not checked in; the deploy brings it with dist/ (README)
  assert.deepEqual(distProblems(biz), []);
});

test('dist check: only index.html copied, a changed part, a missing manifest are each caught; an old one-file page passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'duell-dist-')); mkdirSync(join(dir, 'parts'));
  const body = 'window.Arcade={};', hash = 'sha384-' + createHash('sha384').update(body).digest('base64');
  const page = (man) => writeFileSync(join(dir, 'index.html'), '<script>' + (man ? 'window.DailyParts=' + JSON.stringify(man) + ';' : '') + 'var L=window.DailyParts||{};</script>');
  const man = { play: { f: 'parts/play.0123456789ab.js', h: hash, d: [] }, table: { f: 'parts/table.0123456789ab.js', h: hash, d: ['play'] } };
  page(man);
  assert.deepEqual(distProblems(dir), ['play: parts/play.0123456789ab.js missing', 'table: parts/table.0123456789ab.js missing']);
  writeFileSync(join(dir, man.play.f), body); writeFileSync(join(dir, man.table.f), body);
  assert.deepEqual(distProblems(dir), []);
  writeFileSync(join(dir, man.table.f), body + '\n');
  assert.deepEqual(distProblems(dir), ['table: parts/table.0123456789ab.js does not match its SRI hash']);
  page(null);
  assert.deepEqual(distProblems(dir), ['index.html loads parts but has no manifest']);
  writeFileSync(join(dir, 'index.html'), '<script>var old=1;</script>');
  assert.deepEqual(distProblems(dir), []);
});
