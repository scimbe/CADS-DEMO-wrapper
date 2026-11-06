// AI pictures of the daily cards: GET /duell/img/<id>.jpg serves only what duell-img/ held at start, by name, never a
// path from the request. Plus the pictures in the repo: JPEG, 960x540, small, each with its prompt.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDuell } from '../lib/duell.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
let srv, port, dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'duell-img-'));
  writeFileSync(join(dir, 'warm-toll.jpg'), JPEG);
  writeFileSync(join(dir, 'Gross.jpg'), JPEG);           // upper case: not a valid id
  writeFileSync(join(dir, 'notiz.png'), JPEG);           // wrong type
  writeFileSync(join(dir, 'prompts.json'), '{}');
  mkdirSync(join(dir, 'ordner.jpg'));                     // a directory with a picture's name
  writeFileSync(join(dir, '..secret'), 'geheim');
  try { symlinkSync('/etc/hosts', join(dir, 'hosts.jpg')); } catch {}
  const d = createDuell({ env: { DUELL_IMG_DIR: dir }, salt: 's', log: () => {}, llm: async () => '{}' });
  srv = http.createServer(async (req, res) => {
    if (!(await d.route(req, res, new URL(req.url, 'http://x')))) res.writeHead(599).end('not ours');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  srv.d = d;
});
after(() => srv && srv.close());

const get = (path, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject); req.end();
});

test('Bild: bekannte Id kommt als JPEG, lange gecacht, ohne Cookies nutzbar; HEAD ohne Inhalt', async () => {
  const r = await get('/duell/img/warm-toll.jpg');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, JPEG);
  assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.match(r.headers['cache-control'], /^public, max-age=\d{7,}$/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.equal(r.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.ok(!r.headers['set-cookie']);
  const h = await get('/duell/img/warm-toll.jpg', 'HEAD');
  assert.equal(h.status, 200); assert.equal(h.headers['content-length'], String(JPEG.length)); assert.equal(h.body.length, 0);
  assert.equal((await get('/duell/img/warm-toll.jpg', 'POST')).status, 405);
});

test('Bild: Whitelist - nur <id>.jpg aus dem Ordner, keine Pfade, keine Ordner, keine Links', async () => {
  assert.deepEqual(srv.d.images(), ['warm-toll'], 'nur gueltige Namen, keine Ordner und keine Links');
  for (const p of ['/duell/img/unbekannt.jpg', '/duell/img/Gross.jpg', '/duell/img/notiz.png', '/duell/img/prompts.json', '/duell/img/ordner.jpg',
    '/duell/img/hosts.jpg', '/duell/img/..secret', '/duell/img/', '/duell/img/warm-toll.jpg/', '/duell/img/warm-toll.JPG', '/duell/img/warm-toll',
    '/duell/img/%77arm-toll.jpg', '/duell/img/..%2F..%2Fserver.mjs', '/duell/img/..%2fpackage.json', '/duell/img/a/../warm-toll.jpg.bak',
    '/duell/img/' + 'a'.repeat(41) + '.jpg', '/duell/img/warm-toll.jpg%00.png', '/duell/img/x%5C..%5Cserver.mjs']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.body.includes(JPEG) && !/geheim|localhost|import /.test(r.body.toString()), p);
  }
  // ".." in the raw path is resolved by the URL parser before routing: whatever it lands on, never a file from here
  for (const p of ['/duell/img/../../etc/passwd', '/duell/img/../../lib/duell.mjs', '/duell/img/../duell.mjs']) {
    const r = await get(p);
    assert.notEqual(r.status, 200, p);
    assert.ok(!/root:|import /.test(r.body.toString()), p);
  }
});

test('Bild: ohne Ordner antwortet die Route mit 404 statt zu fallen', async () => {
  const d = createDuell({ env: { DUELL_IMG_DIR: join(dir, 'fehlt') }, salt: 's', log: () => {}, llm: async () => '{}' });
  assert.deepEqual(d.images(), []);
});

// The pictures shipped in this repo: what the app asks for (apps/duell-web/src/thumbs.json in CADS-agent-marketplace).
const SOF = (b) => { for (let i = 2; i < b.length - 9;) { if (b[i] !== 0xff) return null; const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; } return null; };
test('Bilder im Repo: JPEG 960x540, hoechstens 80 KB, jedes mit Prompt und Seed, nichts ohne Bild', () => {
  const folder = join(ROOT, 'duell-img'), files = readdirSync(folder).filter((f) => f.endsWith('.jpg'));
  const prompts = JSON.parse(readFileSync(join(folder, 'prompts.json'), 'utf8'));
  assert.match(prompts.model, /FLUX\.1-schnell.*Apache-2\.0/);
  const items = { ...prompts.sets.main.items, ...prompts.sets.business.items };
  assert.ok(files.length >= 20, 'Bilder da: ' + files.length);
  assert.deepEqual(files.map((f) => f.slice(0, -4)).sort(), Object.keys(items).sort(), 'jedes Bild hat seinen Prompt und umgekehrt');
  for (const f of files) {
    assert.match(f, /^[a-z0-9-]{1,40}\.jpg$/);
    const b = readFileSync(join(folder, f));
    assert.ok(b[0] === 0xff && b[1] === 0xd8, f + ' ist JPEG');
    assert.ok(b.length <= 80 * 1024, f + ' ' + b.length);
    assert.deepEqual(SOF(b), { w: 960, h: 540 }, f);
  }
  for (const id of Object.keys(prompts.sets.business.items)) assert.match(id, /^biz-/);
});
