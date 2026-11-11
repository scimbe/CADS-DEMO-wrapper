// Legal pages of My Daily Idea: served public, never with a placeholder, and linked from the short link pages.
// The release gate: no committed file of the app may hold a placeholder, so this test fails before such a deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLegalPages, LEGAL_PAGES, PLACEHOLDER } from '../lib/legal-pages.mjs';
import { createShortLinks } from '../lib/shortlink.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function serve(s) {
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => s.route(req, res, new URL(req.url, 'http://x')).then((mine) => { if (!mine) res.writeHead(599).end(); }));
    srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.close(); srv.closeAllConnections(); } }));
  });
}
function legalDir(content) {
  const d = mkdtempSync(join(tmpdir(), 'legal-')); mkdirSync(join(d, 'en'));
  for (const p of LEGAL_PAGES) { writeFileSync(join(d, `${p}.html`), content(p, 'de')); writeFileSync(join(d, 'en', `${p}.html`), content(p, 'en')); }
  return d;
}

test('Rechtsseiten: /duell/<seite> und /duell/en/<seite>, oeffentlich, ohne Skript erlaubt', async () => {
  const dir = legalDir((p, l) => `<!doctype html><html lang="${l}"><title>${p}</title><p>Testbetrieb ${p} ${l}</p></html>`);
  const s = await serve(createLegalPages({ env: { DUELL_LEGAL_DIR: dir }, log: () => {} }));
  try {
    for (const p of LEGAL_PAGES) {
      const de = await fetch(`${s.base}/duell/${p}`), en = await fetch(`${s.base}/duell/en/${p}/`);
      assert.equal(de.status, 200); assert.match(await de.text(), new RegExp(`Testbetrieb ${p} de`));
      assert.equal(en.status, 200); assert.match(await en.text(), new RegExp(`Testbetrieb ${p} en`));
      assert.match(de.headers.get('content-security-policy'), /default-src 'none'/);
      assert.ok(!/script-src/.test(de.headers.get('content-security-policy')), 'kein Skript auf Rechtsseiten');
    }
    assert.equal((await fetch(`${s.base}/duell/impressum`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${s.base}/duell/kontakt`)).status, 599, 'unbekannte Seite gehoert nicht uns');
    assert.equal((await fetch(`${s.base}/duell`)).status, 599, '/duell selbst bleibt beim Spiel');
  } finally { s.close(); }
});

test('Rechtsseiten: ein Platzhalter geht nie live, eine fehlende Seite auch nicht', async () => {
  const dir = legalDir((p) => (p === 'impressum' ? `<p>${PLACEHOLDER}BITTE AUSFÜLLEN: Name⟧</p>` : `<p>ok ${p}</p>`));
  const logs = [], s = await serve(createLegalPages({ env: { DUELL_LEGAL_DIR: dir }, log: (o) => logs.push(o) }));
  try {
    const r = await fetch(`${s.base}/duell/impressum`), body = await r.text();
    assert.equal(r.status, 503); assert.ok(!body.includes(PLACEHOLDER) && !body.includes('AUSFÜLLEN'));
    assert.match(body, /wird gerade vorbereitet/); assert.match(body, /href="\/duell"/);
    assert.equal(logs[0].event, 'legal-placeholder');
    assert.equal((await fetch(`${s.base}/duell/datenschutz`)).status, 200);
    const none = await serve(createLegalPages({ env: { DUELL_LEGAL_DIR: join(dir, 'fehlt') }, log: () => {} }));
    try { assert.equal((await fetch(`${none.base}/duell/en/datenschutz`)).status, 503); } finally { none.close(); }
  } finally { s.close(); }
});

test('Release-Gate: keine eingecheckte Datei der App enthaelt einen Platzhalter (Betreiberdaten fehlen -> kein Deploy)', () => {
  const app = join(root, 'apps', 'duell-web');
  const files = [];
  (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } })(app);
  assert.ok(files.length >= 1);
  for (const f of files) assert.ok(!readFileSync(f, 'utf8').includes(PLACEHOLDER), `${f.slice(root.length + 1)} enthaelt ⟦…⟧: erst legal/operator.json im Marketplace ausfuellen, neu bauen, dann kopieren`);
});

test('Kurzlink-Seiten: Impressum und Datenschutz mit einem Tipp, auch auf "abgelaufen" und "unbekannt"', async () => {
  const sh = createShortLinks({ env: { SHORT_DATA_DIR: mkdtempSync(join(tmpdir(), 'short-')) }, log: () => {}, root });
  const made = sh.create({ f: 'i=heute', k: 'idea', l: 'en' });
  const s = await serve(sh);
  try {
    const ok = await (await fetch(`${s.base}/s/${made.body.id}`)).text();
    assert.match(ok, /<footer><a href="\/duell\/en\/impressum">Legal notice<\/a><a href="\/duell\/en\/datenschutz">Privacy<\/a><\/footer>/);
    const miss = await (await fetch(`${s.base}/s/zzzzzzzz`, { headers: { 'Accept-Language': 'de' } })).text();
    assert.match(miss, /<a href="\/duell\/impressum">Impressum<\/a><a href="\/duell\/datenschutz">Datenschutz<\/a>/);
  } finally { s.close(); }
});

test('Server: Rechtsseiten vor dem Login-Gate eingehaengt', () => {
  const src = readFileSync(join(root, 'server.mjs'), 'utf8');
  const at = src.indexOf('await LEGAL.route('), gate = src.indexOf('await AUTH.guard(');
  assert.ok(at > 0 && at < gate, 'LEGAL.route vor AUTH.guard');
  assert.ok(existsSync(join(root, 'lib', 'legal-pages.mjs')));
});
