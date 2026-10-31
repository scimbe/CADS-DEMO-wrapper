// /d/diagram "draw it yourself": the text -> DOT step runs exactly as in the browser, then the vendored Graphviz
// (WebAssembly) really draws it. Plus: the file is the npm package's, and the page serves it.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toDot, isForbiddenDot, BD_MAX_CHARS } from '../lib/diagram-browser-core.mjs';
import { diagramBrowserBlock } from '../lib/diagram-browser.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const GV = join(ROOT, 'static', 'vendor', 'graphviz');
const PROV = JSON.parse(readFileSync(join(GV, 'PROVENANCE.json'), 'utf8'));

test('toDot: chains become edges, real DOT is kept, quotes cannot break out', () => {
  const d = toDot('Besucher -> Markt -> Ergebnis\nMarkt → Prüfung\nAllein');
  assert.match(d, /"Besucher" -> "Markt" -> "Ergebnis";/);
  assert.match(d, /"Markt" -> "Prüfung";/);
  assert.match(d, /"Allein";/);
  assert.equal(toDot('digraph { a -> b }'), 'digraph { a -> b }');
  assert.equal(toDot('   '), '');
  assert.ok(toDot('a" -> b"; evil [URL="x').includes('"a\\"" -> "b\\"; evil [URL=\\"x"'));
});

test('isForbiddenDot: file and link attributes are refused, words in labels are not', () => {
  assert.equal(isForbiddenDot('digraph{a[image="/etc/passwd"]}'), true);
  assert.equal(isForbiddenDot('digraph{a[URL="http://x"]}'), true);
  assert.equal(isForbiddenDot('digraph{a[label="URL, Image"]}'), false);
  assert.equal(isForbiddenDot(toDot('Bild -> URL')), false);
});

test('the vendored Graphviz is the npm package file and draws a real diagram for typed text', async () => {
  const meta = PROV.files['graphviz.js'];
  const buf = readFileSync(join(GV, 'graphviz.js'));
  assert.equal(createHash('sha256').update(buf).digest('hex'), meta.sha256);
  assert.equal(meta.bytes, buf.length);
  assert.equal(PROV.sources['graphviz.js'].package, '@hpcc-js/wasm-graphviz@1.30.0');
  assert.deepEqual(readdirSync(GV).filter((n) => n !== 'PROVENANCE.json' && !PROV.files[n]), [], 'unlisted file');
  assert.match(readFileSync(join(GV, 'LICENSE.hpcc-js-wasm-graphviz-apache-2.0.txt'), 'utf8'), /Apache License\s+Version 2\.0/);
  const { Graphviz } = await import(pathToFileURL(join(GV, 'graphviz.js')).href);
  const gv = await Graphviz.load();
  const svg = gv.dot(toDot('Besucher -> Marktplatz -> Werkzeug\nMarktplatz -> Signatur prüfen'));
  assert.match(svg, /<svg\b/);
  for (const word of ['Besucher', 'Marktplatz', 'Werkzeug', 'Signatur prüfen']) assert.ok(svg.includes(`>${word}</text>`), `${word} is in the drawing`);
  assert.equal((svg.match(/class="edge"/g) || []).length, 3, 'three arrows for three edges');
  assert.throws(() => gv.dot('digraph { a -> '), /syntax error/i, 'a broken text is an error, not a picture');
});

test('the block says what it does, in both languages, and sends nothing', () => {
  for (const lang of ['de', 'en']) {
    const h = diagramBrowserBlock(lang, 'abc');
    assert.match(h, lang === 'de' ? /ohne Konto und ohne KI/ : /no account and no AI/);
    assert.match(h, /maxlength="8000"/);
    assert.ok(!/<form|fetch\(/.test(h));
  }
  assert.equal(BD_MAX_CHARS, 8000);
  const js = readFileSync(join(ROOT, 'static', 'diagram-browser.js'), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(js), 'no network call in the drawing code');
});

let srv, base;
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
before(async () => {
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { srv.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) resolve(); }); srv.on('exit', (c) => reject(new Error('exit ' + c))); });
});
after(() => srv?.kill());

test('/d/diagram offers the browser drawing and serves its files', async () => {
  for (const lang of ['de', 'en']) {
    const h = await (await fetch(`${base}/d/diagram?lang=${lang}`)).text();
    assert.match(h, /id="bd"/);
    assert.match(h, /src="\/pb\/diagram-browser\.js\?v=/);
  }
  const gv = await fetch(`${base}/static/vendor/graphviz/graphviz.js`);
  assert.equal(gv.status, 200);
  assert.match(gv.headers.get('content-type'), /javascript/);
  assert.equal(createHash('sha256').update(Buffer.from(await gv.arrayBuffer())).digest('hex'), PROV.files['graphviz.js'].sha256);
  assert.equal((await fetch(`${base}/static/vendor/graphviz/..%2f..%2f..%2fserver.mjs`)).status, 404);
  for (const f of ['diagram-browser.js', 'diagram-browser-core.mjs']) assert.equal((await fetch(`${base}/pb/${f}`)).status, 200, f);
  const lic = await fetch(`${base}/static/vendor/untertitel/NOTICE.txt`);
  assert.equal(lic.status, 200);
  assert.match(await lic.text(), /GNU General Public License/);
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /Läuft in deinem Browser/);
  assert.match(home, /Zeichnen im Browser/);
});
