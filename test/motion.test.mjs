import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { safeMediaPath, parseRange } from '../lib/static-media.mjs';

const ROOT = new URL('../static/motion/', import.meta.url).pathname;
const VIDEO = '/static/motion/die-idee-16x9.mp4';
const SIZE = statSync(ROOT + 'die-idee-16x9.mp4').size;
let proc, base, port;
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
before(async () => {
  port = await freePort(); base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { const to = setTimeout(() => reject(new Error('no start')), 8000); proc.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) { clearTimeout(to); resolve(); } }); });
});
after(() => proc && proc.kill());
// fetch() normalises ../ away, so raw request paths go through http.request
const raw = (path, headers = {}) => new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port, path, headers }, (r) => { let n = 0; r.on('data', (c) => { n += c.length; }); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, bytes: n })); }).on('error', reject); });

test('content types, length, validators and cache headers', async () => {
  for (const [p, type] of [[VIDEO, 'video/mp4'], ['/static/motion/die-idee-16x9.jpg', 'image/jpeg'], ['/static/motion/captions/die-idee.de.vtt', 'text/vtt']]) {
    const r = await raw(p);
    assert.equal(r.status, 200, p); assert.ok(r.headers['content-type'].startsWith(type), p);
    assert.equal(r.headers['accept-ranges'], 'bytes'); assert.match(r.headers['cache-control'], /max-age=\d+/); assert.ok(r.headers.etag);
  }
});

test('Range: 206 with Content-Range for bytes=0-99, open-ended and suffix; 416 beyond the end', async () => {
  let r = await raw(VIDEO, { Range: 'bytes=0-99' });
  assert.equal(r.status, 206); assert.equal(r.headers['content-range'], `bytes 0-99/${SIZE}`); assert.equal(r.bytes, 100);
  r = await raw(VIDEO, { Range: 'bytes=100-' });
  assert.equal(r.status, 206); assert.equal(r.bytes, SIZE - 100);
  r = await raw(VIDEO, { Range: 'bytes=-50' });
  assert.equal(r.status, 206); assert.equal(r.bytes, 50);
  r = await raw(VIDEO, { Range: `bytes=${SIZE + 5}-` });
  assert.equal(r.status, 416); assert.equal(r.headers['content-range'], `bytes */${SIZE}`);
});

test('If-None-Match -> 304', async () => {
  const { headers } = await raw(VIDEO);
  assert.equal((await raw(VIDEO, { 'If-None-Match': headers.etag })).status, 304);
});

test('path traversal, hidden files, unknown types and directories are 404', async () => {
  for (const p of ['/static/motion/../../server.mjs', '/static/motion/..%2f..%2fserver.mjs', '/static/motion/%2e%2e/demos.json', '/static/motion/README.md', '/static/motion/captions/', '/static/motion/nope.mp4', '/static/motion/%00.mp4', '/static/motion/..\\server.mjs']) {
    assert.equal((await raw(p)).status, 404, p);
  }
});

test('safeMediaPath / parseRange units', () => {
  assert.equal(safeMediaPath('/r', '../x.mp4'), null);
  assert.equal(safeMediaPath('/r', 'a/../../x.mp4'), null);
  assert.equal(safeMediaPath('/r', 'a.mp4'), '/r/a.mp4');
  assert.deepEqual(parseRange('bytes=5-9', 100), { start: 5, end: 9 });
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
  assert.equal(parseRange('bytes=0-1,5-6', 100), null);
  assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
});

test('embeds: hero die-idee (no autoplay, preload none), row nordwind+sicher, EN files for lang=en, herkunft collapsed on newsletter', async () => {
  const de = await (await fetch(base + '/')).text();
  assert.match(de, /die-idee-16x9\.mp4/); assert.match(de, /nordwind-16x9\.mp4/); assert.match(de, /sicher-16x9\.mp4/);
  assert.ok(!/autoplay/i.test(de)); assert.match(de, /preload="none"/);
  const en = await (await fetch(base + '/?lang=en')).text();
  assert.match(en, /die-idee-16x9\.en\.mp4/); assert.match(en, /srclang="en"[^>]*default/);
  const nl = await (await fetch(base + '/d/newsletter')).text();
  assert.match(nl, /<details class="motion-d"><summary>Wie funktioniert die Prüfung\?<\/summary>[\s\S]*herkunft-16x9\.mp4/);
  assert.ok(!/autoplay/i.test(nl));
  // every file an embed points at exists
  for (const m of new Set([...(de + en + nl).matchAll(/(?:data-wide|data-tall|data-poster-wide|data-poster-tall|src|poster)="(\/static\/motion\/[^"]+)"/g)].map((x) => x[1]))) {
    assert.equal((await raw(m)).status, 200, m);
  }
});
