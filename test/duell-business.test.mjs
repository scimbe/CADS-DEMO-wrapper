// Daily Business at /duell/business/ (lib/duell.mjs): the business build of the app (`node scripts/build.js --flavor business`
// -> dist/business/) next to the game page, with its own page and parts, compressed with a content ETag like /duell, while
// /duell itself answers exactly as before. Raw node:http requests, because fetch() would decompress and hide Content-Encoding.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createDuell } from '../lib/duell.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps', 'duell-web', 'dist');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const GAME_PART = 'play.0123456789ab.js', BIZ_PART = 'biz.abcdef012345.js';
let proc, port, dir, page, bizPage;

function raw(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'duell-business-'));
  copyFileSync(join(DIST, 'index.html'), join(dir, 'index.html'));
  mkdirSync(join(dir, 'parts')); mkdirSync(join(dir, 'business', 'parts'), { recursive: true });
  writeFileSync(join(dir, 'parts', GAME_PART), 'window.Arcade = { play() { return "' + 'arcade '.repeat(400) + '"; } };\n');
  // the shape of the real business page: its title, its CSP in a meta tag, a parts manifest with paths relative to the page
  writeFileSync(join(dir, 'business', 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'self\'"><title>Daily Business</title></head><body><script>window.DailyParts={"biz":{"f":"parts/' + BIZ_PART + '","h":"sha384-x","d":[]}};' + '/* office cards */'.repeat(200) + '</script></body></html>\n');
  writeFileSync(join(dir, 'business', 'parts', BIZ_PART), 'window.Biz = { onboarding() { return "' + 'meeting '.repeat(400) + '"; } };\n');
  page = readFileSync(join(dir, 'index.html')); bizPage = readFileSync(join(dir, 'business', 'index.html'));
  port = await freePort();
  // DUELL_BIZ_FILE is not set: the business build is found next to the game page, as in the container
  proc = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', DUELL_WEB_FILE: join(dir, 'index.html') }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 8000);
    proc.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) { clearTimeout(to); resolve(); } });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
});
after(() => { if (proc) proc.kill(); });

test('/duell/business/ and /duell/business: 200, the business page with its title, no-cache like /duell; HEAD has no body', async () => {
  for (const path of ['/duell/business/', '/duell/business']) {
    const r = await raw(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(r.body.equals(bizPage), path);
    assert.match(String(r.body), /<title>Daily Business<\/title>/);
  }
  const h = await raw('/duell/business/', { method: 'HEAD', headers: { 'Accept-Encoding': 'br' } });
  assert.equal(h.status, 200); assert.equal(h.body.length, 0); assert.equal(h.headers['content-encoding'], 'br');
  assert.equal((await raw('/duell/business/', { method: 'POST' })).status, 405);
});

test('/duell/business/: brotli and gzip decode to the page; If-None-Match gets 304; the tag differs from /duell', async () => {
  const br = await raw('/duell/business/', { headers: { 'Accept-Encoding': 'gzip, deflate, br' } });
  assert.equal(br.headers['content-encoding'], 'br'); assert.match(br.headers.vary, /Accept-Encoding/);
  assert.ok(brotliDecompressSync(br.body).equals(bizPage));
  const gz = await raw('/duell/business/', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(gz.headers['content-encoding'], 'gzip'); assert.ok(gunzipSync(gz.body).equals(bizPage));
  const nm = await raw('/duell/business/', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': br.headers.etag } });
  assert.equal(nm.status, 304); assert.equal(nm.body.length, 0);
  assert.equal((await raw('/duell/business/', { headers: { 'If-None-Match': '"old"' } })).status, 200);
  const game = await raw('/duell', { headers: { 'Accept-Encoding': 'br' } });
  assert.notEqual(game.headers.etag, br.headers.etag);
  assert.equal((await raw('/duell/business/', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': game.headers.etag } })).status, 200, 'the game page tag is no tag of the business page');
});

test('business parts: from dist/business/parts/, compressed, immutable, 304; never the game parts and never a path', async () => {
  const p = await raw('/duell/business/parts/' + BIZ_PART, { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(p.status, 200); assert.equal(p.headers['content-encoding'], 'br');
  assert.equal(p.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.match(p.headers['cache-control'], /immutable/); assert.equal(p.headers['cross-origin-resource-policy'], 'same-origin');
  assert.ok(brotliDecompressSync(p.body).equals(readFileSync(join(dir, 'business', 'parts', BIZ_PART))));
  const gz = await raw('/duell/business/parts/' + BIZ_PART, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.ok(gunzipSync(gz.body).equals(readFileSync(join(dir, 'business', 'parts', BIZ_PART))));
  assert.equal((await raw('/duell/business/parts/' + BIZ_PART, { headers: { 'If-None-Match': p.headers.etag } })).status, 304);
  assert.equal((await raw('/duell/business/parts/' + GAME_PART)).status, 404, 'a part of the game is no part of business');
  assert.equal((await raw('/duell/parts/' + BIZ_PART)).status, 404, 'a part of business is no part of the game');
  for (const bad of ['/duell/business/parts/..%2Findex.html', '/duell/business/parts/../index.html', '/duell/business/parts/BIZ.abcdef012345.js', '/duell/business/index.html']) {
    assert.notEqual((await raw(bad)).status, 200, bad);
  }
});

test('/duell unchanged: the same page, its parts, no business content; no service worker under either path', async () => {
  for (const path of ['/duell', '/duell/']) {
    const r = await raw(path);
    assert.equal(r.status, 200); assert.ok(r.body.equals(page), path); assert.doesNotMatch(String(r.body), /Daily Business/);
    assert.equal(r.headers['cache-control'], 'no-cache');
  }
  const gp = await raw('/duell/parts/' + GAME_PART, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(gp.status, 200); assert.ok(gunzipSync(gp.body).equals(readFileSync(join(dir, 'parts', GAME_PART))));
  // a service worker registered under /duell/ would control /duell/business/ too: there is none to register
  for (const sw of ['/duell/sw.js', '/duell/service-worker.js', '/duell/business/sw.js']) assert.notEqual((await raw(sw)).status, 200, sw);
  assert.doesNotMatch(String(page) + String(bizPage), /serviceWorker\.register/);
});

test('no business build deployed: /duell/business/ is a clear 404, /duell keeps working', async () => {
  const d = mkdtempSync(join(tmpdir(), 'duell-nobiz-'));
  copyFileSync(join(DIST, 'index.html'), join(d, 'index.html'));
  const duell = createDuell({ env: { DUELL_WEB_FILE: join(d, 'index.html') }, log: () => {} });
  assert.equal(duell.cfg.bizFile, join(d, 'business', 'index.html'));
  const call = (p) => new Promise((resolve) => {
    const res = { headers: {}, writeHead(s, h) { this.status = s; Object.assign(this.headers, h || {}); return this; }, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; resolve(this); } };
    duell.route({ method: 'GET', headers: {} }, res, new URL('http://x' + p));
  });
  const r = await call('/duell/business/');
  assert.equal(r.status, 404); assert.equal(String(r.body), 'duell: no business build');
  assert.equal(createDuell({ env: { DUELL_BIZ_FILE: '/elsewhere/biz.html' }, root: '/app', log: () => {} }).cfg.bizFile, '/elsewhere/biz.html');
  assert.equal(createDuell({ env: {}, root: '/app', log: () => {} }).cfg.bizFile, '/app/apps/duell-web/dist/business/index.html');
});
