// Compression and validators (lib/compress.mjs): brotli/gzip by Accept-Encoding for the game page, its parts, the protocol
// page and vendored scripts; content ETag with 304; Range and HEAD never get a compressed or mismatched body; pictures and
// video stay untouched. Raw node:http requests, because fetch() would decompress and hide Content-Encoding.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { pickEncoding, etagMatches, createCompressedFiles } from '../lib/compress.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps', 'duell-web', 'dist');

test('pickEncoding: br before gzip, q=0 refuses, * counts, nothing known -> identity', () => {
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('gzip;q=1, br;q=0.5'), 'gzip');
  assert.equal(pickEncoding('*'), 'br');
  assert.equal(pickEncoding('*;q=0'), null);
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(''), null);
  assert.equal(pickEncoding(undefined), null);
  assert.equal(pickEncoding('x-gzip'), 'gzip');
});

test('etagMatches: same content in any coding, weak or strong, lists and *', () => {
  assert.ok(etagMatches('"abc"', 'abc'));
  assert.ok(etagMatches('"abc-br"', 'abc'));
  assert.ok(etagMatches('W/"abc-gz"', 'abc'));
  assert.ok(etagMatches('"x", "abc"', 'abc'));
  assert.ok(etagMatches('*', 'abc'));
  assert.ok(!etagMatches('"abd"', 'abc'));
  assert.ok(!etagMatches('abc', 'abc'), 'unquoted is no tag');
  assert.ok(!etagMatches('', 'abc'));
});

test('cache: a changed file gets a new ETag; large files are left to the caller', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'compress-')), f = join(dir, 'a.js');
  writeFileSync(f, 'x'.repeat(5000));
  const c = createCompressedFiles({ maxBytes: 10000 });
  const a = await c.load(f);
  writeFileSync(f, 'y'.repeat(5000)); utimesSync(f, new Date(), new Date(Date.now() + 5000));
  const b = await c.load(f);
  assert.notEqual(a.hash, b.hash);
  writeFileSync(f, 'z'.repeat(20000));
  assert.equal(await c.load(f), null);
  const small = join(dir, 'small.js'); writeFileSync(small, 'tiny');
  assert.equal((await c.load(small)).br, undefined, 'below 1 KB nothing is compressed');
});

// ---- over HTTP: the real server, the real built page ----------------------------------------------------------
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
let proc, port, dir, page;
const PART = 'play.0123456789ab.js';

/** Raw request: { status, headers, body: Buffer } without any decoding. */
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
  dir = mkdtempSync(join(tmpdir(), 'duell-compress-'));
  copyFileSync(join(DIST, 'index.html'), join(dir, 'index.html'));
  copyFileSync(join(DIST, 'protokoll.html'), join(dir, 'protokoll.html'));
  copyFileSync(join(DIST, 'protokoll-worker.js'), join(dir, 'protokoll-worker.js'));
  mkdirSync(join(dir, 'parts'));
  writeFileSync(join(dir, 'parts', PART), 'window.Arcade = { play() { return "' + 'arcade '.repeat(400) + '"; } };\n');
  page = readFileSync(join(dir, 'index.html'));
  port = await freePort();
  proc = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', DUELL_WEB_FILE: join(dir, 'index.html') }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 8000);
    proc.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) { clearTimeout(to); resolve(); } });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
});
after(() => { if (proc) proc.kill(); });

test('/duell: brotli for br, gzip for gzip, identity without; each decodes to the page byte for byte', async (t) => {
  const id = await raw('/duell');
  assert.equal(id.status, 200); assert.equal(id.headers['content-encoding'], undefined);
  assert.equal(Number(id.headers['content-length']), page.length); assert.ok(id.body.equals(page));
  assert.equal(id.headers.vary, 'Accept-Encoding'); assert.equal(id.headers['cache-control'], 'no-cache');

  const br = await raw('/duell', { headers: { 'Accept-Encoding': 'gzip, deflate, br' } });
  assert.equal(br.headers['content-encoding'], 'br'); assert.equal(Number(br.headers['content-length']), br.body.length);
  assert.ok(brotliDecompressSync(br.body).equals(page));
  assert.equal(br.headers['content-type'], 'text/html; charset=utf-8'); assert.equal(br.headers['referrer-policy'], 'no-referrer');

  const gz = await raw('/duell', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(gz.headers['content-encoding'], 'gzip'); assert.ok(gunzipSync(gz.body).equals(page));

  assert.ok(br.body.length < page.length * 0.35, `br ${br.body.length} B of ${page.length} B`);
  assert.ok(gz.body.length < page.length * 0.4, `gzip ${gz.body.length} B of ${page.length} B`);
  t.diagnostic(`/duell before ${page.length} B, gzip ${gz.body.length} B (${Math.round(100 - 100 * gz.body.length / page.length)} % less), br ${br.body.length} B (${Math.round(100 - 100 * br.body.length / page.length)} % less)`);
  assert.notEqual(br.headers.etag, gz.headers.etag); assert.notEqual(gz.headers.etag, id.headers.etag);
});

test('/duell: If-None-Match answers 304 without body, for the tag of any coding; a stale tag gets the page', async () => {
  const first = await raw('/duell', { headers: { 'Accept-Encoding': 'br' } });
  for (const inm of [first.headers.etag, first.headers.etag.replace('-br"', '"'), 'W/' + first.headers.etag, '"nope", ' + first.headers.etag]) {
    const r = await raw('/duell', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': inm } });
    assert.equal(r.status, 304, inm); assert.equal(r.body.length, 0); assert.equal(r.headers.etag, first.headers.etag);
    assert.equal(r.headers['content-encoding'], undefined, '304 carries no body coding');
  }
  const stale = await raw('/duell', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': '"old"' } });
  assert.equal(stale.status, 200); assert.ok(brotliDecompressSync(stale.body).equals(page));
});

test('/duell: HEAD sends the GET headers (coding and length of that body) and no body', async () => {
  for (const ae of ['br', 'gzip', '']) {
    const g = await raw('/duell', { headers: { 'Accept-Encoding': ae } });
    const h = await raw('/duell', { method: 'HEAD', headers: { 'Accept-Encoding': ae } });
    assert.equal(h.status, 200); assert.equal(h.body.length, 0);
    for (const k of ['content-encoding', 'content-length', 'etag', 'vary', 'content-type', 'cache-control']) assert.equal(h.headers[k], g.headers[k], ae + ' ' + k);
  }
  assert.equal((await raw('/duell', { method: 'POST' })).status, 405);
});

test('/duell: Range is not applied to the page and never mixes with compression', async () => {
  const r = await raw('/duell', { headers: { 'Accept-Encoding': 'br', Range: 'bytes=0-99' } });
  assert.equal(r.status, 200, 'no ranges on the page: the whole page');
  assert.ok(brotliDecompressSync(r.body).equals(page));
  assert.equal(r.headers['content-range'], undefined);
});

test('parts (hash in the name): compressed and immutable; protocol page and worker compressed with their isolation headers', async () => {
  const p = await raw('/duell/parts/' + PART, { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(p.status, 200); assert.equal(p.headers['content-encoding'], 'br');
  assert.match(p.headers['cache-control'], /immutable/); assert.equal(p.headers['cross-origin-resource-policy'], 'same-origin');
  assert.ok(brotliDecompressSync(p.body).equals(readFileSync(join(dir, 'parts', PART))));
  assert.equal((await raw('/duell/parts/' + PART, { headers: { 'If-None-Match': p.headers.etag } })).status, 304);
  assert.equal((await raw('/duell/parts/table.0123456789ab.js')).status, 404);

  for (const [path, file] of [['/duell/protokoll', 'protokoll.html'], ['/duell/protokoll-worker.js', 'protokoll-worker.js']]) {
    const r = await raw(path, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.status, 200, path); assert.equal(r.headers['cross-origin-embedder-policy'], 'require-corp', path);
    assert.equal(r.headers['cache-control'], 'no-cache');
    const body = readFileSync(join(dir, file));
    if (body.length >= 1024) { assert.equal(r.headers['content-encoding'], 'gzip', path); assert.ok(gunzipSync(r.body).equals(body), path); }
    else assert.ok(r.body.equals(body), path);
  }
});

test('static vendor script: compressed in full; a Range gets 206 on the identity bytes, no Content-Encoding', async () => {
  const file = readFileSync(join(ROOT, 'static', 'vendor', 'untertitel', 'shout.wasm.js'));
  const full = await raw('/static/vendor/untertitel/shout.wasm.js', { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(full.status, 200); assert.equal(full.headers['content-encoding'], 'br'); assert.equal(full.headers['accept-ranges'], 'bytes');
  assert.ok(brotliDecompressSync(full.body).equals(file));
  assert.equal(full.headers['cross-origin-embedder-policy'], 'require-corp', 'page headers kept');

  const part = await raw('/static/vendor/untertitel/shout.wasm.js', { headers: { 'Accept-Encoding': 'br', Range: 'bytes=100-199' } });
  assert.equal(part.status, 206); assert.equal(part.headers['content-encoding'], undefined);
  assert.equal(part.headers['content-range'], `bytes 100-199/${file.length}`); assert.equal(Number(part.headers['content-length']), 100);
  assert.ok(part.body.equals(file.subarray(100, 200)));
  const headPart = await raw('/static/vendor/untertitel/shout.wasm.js', { method: 'HEAD', headers: { 'Accept-Encoding': 'br', Range: 'bytes=100-199' } });
  assert.equal(headPart.status, 206); assert.equal(headPart.body.length, 0); assert.equal(headPart.headers['content-encoding'], undefined);
  assert.equal((await raw('/static/vendor/untertitel/shout.wasm.js', { headers: { Range: `bytes=${file.length}-` } })).status, 416);
  const ifRange = await raw('/static/vendor/untertitel/shout.wasm.js', { headers: { Range: 'bytes=0-9', 'If-Range': '"other"' } });
  assert.equal(ifRange.status, 200, 'If-Range of another version: the whole file'); assert.ok(ifRange.body.equals(file));
  assert.equal((await raw('/static/vendor/untertitel/shout.wasm.js', { headers: { 'If-None-Match': full.headers.etag } })).status, 304);
});

test('pictures and video are never compressed', async () => {
  const img = readdirSync(join(ROOT, 'duell-img')).find((f) => /^[a-z0-9-]+\.jpg$/.test(f));
  const r = await raw('/duell/img/' + img, { headers: { 'Accept-Encoding': 'br, gzip' } });
  assert.equal(r.status, 200); assert.equal(r.headers['content-encoding'], undefined);
  assert.ok(r.body.equals(readFileSync(join(ROOT, 'duell-img', img))));
  const vid = readdirSync(join(ROOT, 'static', 'motion')).find((f) => f.endsWith('.mp4'));
  const v = await raw('/static/motion/' + vid, { method: 'HEAD', headers: { 'Accept-Encoding': 'br, gzip' } });
  assert.equal(v.status, 200); assert.equal(v.headers['content-encoding'], undefined); assert.equal(v.headers['accept-ranges'], 'bytes');
  const vr = await raw('/static/motion/' + vid, { headers: { 'Accept-Encoding': 'br', Range: 'bytes=0-15' } });
  assert.equal(vr.status, 206); assert.equal(vr.headers['content-encoding'], undefined); assert.equal(vr.body.length, 16);
});

test('builder assets: compressed, ?v= stays immutable, without it no-cache with a working 304', async () => {
  const a = await raw('/pb/prompt-builder.js?v=1', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(a.status, 200); assert.equal(a.headers['content-encoding'], 'gzip'); assert.match(a.headers['cache-control'], /immutable/);
  assert.ok(gunzipSync(a.body).equals(readFileSync(join(ROOT, 'static', 'prompt-builder.js'))));
  const b = await raw('/pb/prompt-core.mjs', { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(b.headers['cache-control'], 'no-cache');
  assert.equal((await raw('/pb/prompt-core.mjs', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': b.headers.etag } })).status, 304);
});
