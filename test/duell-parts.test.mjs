// Staging finding L1: /duell/parts/* serves the parts of the new app (apps/mdi: card-<id>.<sha12>.js, thumbs-<n>.<sha12>.js,
// live-frame.<sha10>.html), only names its dist/build.json lists, with type and cache headers per kind; the old duell-web
// build (no build.json) keeps its own pattern.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';

const CARD = 'card-zug-abfragen.0123456789ab.js', THUMB = 'thumbs-0.abcdef012345.js', LIVE = 'live-frame.0123456789.html', FEAT = 'feat-klang-rap.fedcba987654.js';
/** A dist folder as apps/mdi scripts/build.js writes it. */
function mdiDist(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'duell-parts-')), parts = join(dir, 'parts');
  mkdirSync(parts);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>My Daily Idea</title>');
  writeFileSync(join(parts, CARD), 'window.Card=1;\n');
  writeFileSync(join(parts, THUMB), 'window.Thumbs=1;\n');
  writeFileSync(join(parts, FEAT), 'window.Feat=1;\n');
  writeFileSync(join(parts, LIVE), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title>live</title>\n');
  writeFileSync(join(parts, 'card-unlisted.0123456789ab.js'), 'window.Unlisted=1;\n');   // lies there, but the app does not list it
  writeFileSync(join(parts, 'notes.txt'), 'secret');
  writeFileSync(join(dir, 'secret.txt'), 'outside parts');
  const build = { feats: { 'klang-rap': { file: 'parts/' + FEAT, sri: 'sha384-x' } }, parts: { live: { file: 'parts/' + LIVE } }, report: { core: 1, parts: { ['parts/' + LIVE]: 1, 'remote/play-frame.html': 1, ['parts/' + CARD]: 1, ['parts/' + THUMB]: 1, ['parts/' + FEAT]: 1, 'parts/feat-Klang.0123456789ab.js': 1, 'parts/../secret.txt': 1, 'parts/Card-X.0123456789ab.js': 1 } }, ...extra };
  writeFileSync(join(dir, 'build.json'), JSON.stringify(build));
  return dir;
}
async function serve(t, webFile, logs = []) {
  const d = createDuell({ env: { DUELL_WEB_FILE: webFile }, salt: 's', log: (o) => logs.push(o), llm: async () => '{}' });
  const srv = http.createServer((req, res) => d.route(req, res, new URL(req.url, 'http://x')).then((mine) => { if (!mine) res.writeHead(599).end(); }));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const close = () => { srv.close(); srv.closeAllConnections(); };
  t.after(close);   // also when an assertion fails: an open server would keep the test process alive
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => {} };
}

test('L1: the parts of apps/mdi are served with their type, a year of immutable cache and nosniff', async (t) => {
  const dir = mdiDist(), h = await serve(t, join(dir, 'index.html'));
  for (const [name, type, body] of [[CARD, /^text\/javascript; charset=utf-8$/, 'window.Card=1;\n'], [THUMB, /^text\/javascript; charset=utf-8$/, 'window.Thumbs=1;\n'], [FEAT, /^text\/javascript; charset=utf-8$/, 'window.Feat=1;\n']]) {
    const r = await fetch(`${h.base}/duell/parts/${name}`);
    assert.equal(r.status, 200, name); assert.match(r.headers.get('content-type'), type);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(await r.text(), body);
    assert.equal((await fetch(`${h.base}/duell/parts/${name}`, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(`${h.base}/duell/parts/${name}`, { method: 'POST' })).status, 405);
  }
  h.close();
});

test('L1/L3: the local live frame comes as HTML, may be framed by this origin only, and never with X-Frame-Options', async (t) => {
  const dir = mdiDist(), h = await serve(t, join(dir, 'index.html'));
  const r = await fetch(`${h.base}/duell/parts/${LIVE}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'self'; base-uri 'none'");
  assert.equal(r.headers.get('x-frame-options'), null, 'the app embeds the frame itself');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.match(await r.text(), /<title>live<\/title>/);
  h.close();
});

test('L1: only names the app lists; nothing else from parts/, nothing outside it, no path tricks', async (t) => {
  const dir = mdiDist(), logs = [], h = await serve(t, join(dir, 'index.html'), logs);
  symlinkSync(join(dir, 'secret.txt'), join(dir, 'parts', 'card-link.0123456789ab.js'));
  for (const bad of [
    'card-unlisted.0123456789ab.js',    // lies in parts/, the app does not list it
    'card-link.0123456789ab.js',        // a link out of parts/, not listed
    'notes.txt', 'Card-X.0123456789ab.js', 'card-zug-abfragen.0123456789AB.js', 'card-zug-abfragen.js', 'live-frame.0123456789.htm',
    '..%2Fsecret.txt', '%2e%2e%2fsecret.txt', '..%5Csecret.txt', 'card-zug-abfragen.0123456789ab.js%00', 'card-zug-abfragen.0123456789ab.js%2F..%2F..%2Fsecret.txt',
  ]) {
    const r = await fetch(`${h.base}/duell/parts/${bad}`);
    assert.equal(r.status, 404, bad); assert.doesNotMatch(await r.text(), /secret|outside parts|Unlisted/, bad);
  }
  for (const bad of ['/duell/parts/../secret.txt', '/duell/parts//' + CARD, '/duell/parts/sub/' + CARD, '/duell/secret.txt', '/duell/parts/' + 'x'.repeat(81)]) assert.notEqual((await fetch(h.base + bad)).status, 200, bad);
  // names in build.json that do not fit the app's own naming are refused (and logged), "parts/../secret.txt" included
  assert.ok(logs.some((o) => o.event === 'duell-part-name-refused' && o.name === '../secret.txt'));
  assert.ok(logs.some((o) => o.event === 'duell-part-name-refused' && o.name === 'Card-X.0123456789ab.js'));
  assert.ok(logs.some((o) => o.event === 'duell-part-name-refused' && o.name === 'feat-Klang.0123456789ab.js'), 'feature parts: same strict form');
  h.close();
});

test('L1: a new dist is picked up without a restart; an unreadable build.json serves no part (fail closed)', async (t) => {
  const dir = mdiDist(), logs = [], h = await serve(t, join(dir, 'index.html'), logs);
  assert.equal((await fetch(`${h.base}/duell/parts/${CARD}`)).status, 200);
  const NEXT = 'card-gruss.bbbbbbbbbbbb.js';
  writeFileSync(join(dir, 'parts', NEXT), 'window.Next=1;\n');
  writeFileSync(join(dir, 'build.json'), JSON.stringify({ parts: { live: { file: 'parts/' + LIVE } }, report: { parts: { ['parts/' + NEXT]: 1 } } }));
  utimesSync(join(dir, 'build.json'), new Date(), new Date(Date.now() + 5000));
  assert.equal((await fetch(`${h.base}/duell/parts/${NEXT}`)).status, 200, 'listed now');
  assert.equal((await fetch(`${h.base}/duell/parts/${CARD}`)).status, 404, 'no longer listed');
  writeFileSync(join(dir, 'build.json'), '{ kaputt');
  utimesSync(join(dir, 'build.json'), new Date(), new Date(Date.now() + 10000));
  assert.equal((await fetch(`${h.base}/duell/parts/${NEXT}`)).status, 404);
  assert.ok(logs.some((o) => o.event === 'duell-parts-list-unreadable'));
  h.close();
});

test('L1: the old duell-web build (no build.json) keeps its parts and pattern; it gets none of the new names', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'duell-parts-old-')); mkdirSync(join(dir, 'parts'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>My Daily Idea</title>');
  writeFileSync(join(dir, 'parts', 'play.0123456789ab.js'), 'window.Old=1;\n');
  writeFileSync(join(dir, 'parts', CARD), 'window.Card=1;\n');
  const h = await serve(t, join(dir, 'index.html'));
  assert.equal((await fetch(`${h.base}/duell/parts/play.0123456789ab.js`)).status, 200);
  assert.equal((await fetch(`${h.base}/duell/parts/${CARD}`)).status, 404);
  h.close();
});
