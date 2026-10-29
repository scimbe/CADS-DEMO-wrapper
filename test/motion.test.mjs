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

test('embeds: hero so-einfach (no autoplay, preload none), row termin-per-anruf + frag-deine-region with live links, EN files for lang=en, herkunft collapsed on newsletter', async () => {
  const de = await (await fetch(base + '/')).text();
  assert.match(de, /so-einfach-16x9\.mp4/); assert.match(de, /so-einfach-9x16\.mp4/);
  assert.match(de, /termin-per-anruf-16x9\.mp4/); assert.match(de, /frag-deine-region-16x9\.mp4/);
  assert.ok(!/die-idee-16x9|nordwind-16x9|sicher-16x9/.test(de), 'old technology videos are no longer embedded');
  assert.match(de, /href="https:\/\/assistent-cal-f29c55da\.bunsenbrenner\.org\/" target="_blank" rel="noopener noreferrer"/);
  assert.match(de, /captions\/so-einfach\.de\.vtt/);
  assert.ok(!/autoplay/i.test(de)); assert.match(de, /preload="none"/);
  const en = await (await fetch(base + '/?lang=en')).text();
  assert.match(en, /so-einfach-16x9\.en\.mp4/); assert.match(en, /frag-deine-region-9x16\.en\.mp4/); assert.match(en, /srclang="en"[^>]*default/);
  const nl = await (await fetch(base + '/d/newsletter')).text();
  assert.match(nl, /<details class="motion-d"><summary>Wie funktioniert die Prüfung\?<\/summary>[\s\S]*herkunft-16x9\.mp4/);
  assert.ok(!/autoplay/i.test(nl));
  // every file an embed points at exists
  for (const m of new Set([...(de + en + nl).matchAll(/(?:data-wide|data-tall|data-poster-wide|data-poster-tall|src|poster)="(\/static\/motion\/[^"]+)"/g)].map((x) => x[1]))) {
    assert.equal((await raw(m)).status, 200, m);
  }
});

test('use-case videos: every cut, poster and caption exists; captions follow the narration and end inside the video', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const M = new URL('../motion/src/', import.meta.url).pathname;
  const narr = JSON.parse(readFileSync(M + 'narration.json', 'utf8'));
  const timing = JSON.parse(readFileSync(M + 'vo-timing.json', 'utf8'));
  for (const [slug, scenes] of Object.entries(narr)) {
    for (const lang of ['de', 'en']) {
      for (const shape of ['16x9', '9x16']) for (const ext of ['mp4', 'jpg']) {
        const f = `${ROOT}${slug}-${shape}${lang === 'en' ? '.en' : ''}.${ext}`;
        assert.ok(existsSync(f), f);
      }
      const vtt = readFileSync(`${ROOT}captions/${slug}.${lang}.vtt`, 'utf8');
      const cues = [...vtt.matchAll(/(\d\d):(\d\d):(\d\d\.\d{3}) --> (\d\d):(\d\d):(\d\d\.\d{3})\n(.+)/g)];
      assert.deepEqual(cues.map((c) => c[7]), scenes.map((s) => s[lang]), `${slug}.${lang}: captions = spoken lines`);
      const end = (c) => +c[4] * 3600 + +c[5] * 60 + +c[6];
      assert.ok(end(cues.at(-1)) <= timing[slug][lang].total / 30, `${slug}.${lang}: last cue inside the video`);
    }
  }
  assert.ok(timing['so-einfach'].de.total / 30 < 40, 'main video under 40 s');
  for (const s of ['termin-per-anruf', 'frag-deine-region']) for (const l of ['de', 'en']) assert.ok(timing[s][l].total / 30 <= 25, `${s}.${l} at most 25 s`);
});
