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

test('embeds: hero so-einfach (no autoplay, preload none), row termin-per-anruf with live link, card clips, EN files for lang=en, herkunft collapsed on newsletter', async () => {
  const de = await (await fetch(base + '/')).text();
  assert.match(de, /so-einfach-16x9\.mp4/); assert.match(de, /so-einfach-9x16\.mp4/);
  assert.match(de, /termin-per-anruf-16x9\.mp4/); assert.match(de, /frag-deine-region-16x9\.mp4/);
  assert.ok(!/(die-idee|nordwind|[^a-z]sicher)-(16x9|9x16)/.test(de), 'old technology videos are no longer embedded');
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
  for (const s of Object.keys(narr).filter((x) => x !== 'so-einfach')) for (const l of ['de', 'en']) assert.ok(timing[s][l].total / 30 <= 25, `${s}.${l} at most 25 s`);
  // the cancellation stays on screen long enough to read
  for (const l of ['de', 'en']) assert.ok(timing['termin-per-anruf'][l].scenes[2].len / 30 >= 6, `cancel scene ${l}`);
});

test('every demo card with a video points at an existing clip; closed cards load nothing; each clip belongs to one card', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const demos = JSON.parse(readFileSync(new URL('../demos.json', import.meta.url), 'utf8'));
  const visible = Object.entries(demos).filter(([, d]) => !d.hidden && d.live);
  const de = await (await fetch(base + '/')).text();
  const clips = visible.map(([, d]) => d.video).filter(Boolean);
  assert.equal(new Set(clips).size, clips.length);
  assert.equal(clips.length, visible.length, 'all live cards have a clip');
  for (const c of clips) {
    assert.ok(existsSync(`${ROOT}${c}-16x9.mp4`), c);
    if (c !== 'so-einfach') assert.ok(!new RegExp(`poster="/static/motion/${c}-`).test(de), `${c}: no poster request before opening`);
    assert.match(de, new RegExp(`data-wide="/static/motion/${c}-16x9\\.mp4"`));
  }
  assert.match(de, /class="cardvid"/);
  assert.match(de, /v\.pause\(\)/, 'closing a card stops its video');
});

test('use-case scenes: problem first, one closing click, readable crops, plain language', async () => {
  const { readFileSync } = await import('node:fs');
  const { BOX, MIN_SCALE, SIZES, cropFor } = await import('../motion/src/crop.ts');
  const M = new URL('../motion/', import.meta.url).pathname;
  const spec = JSON.parse(readFileSync(M + 'src/usecases.json', 'utf8'));
  const narr = JSON.parse(readFileSync(M + 'src/narration.json', 'utf8'));
  const rects = JSON.parse(readFileSync(M + 'public/real/uc/rects.json', 'utf8'));
  const TECH = /signatur|prompt|sandbox|server|modell|algorithm|workflow|worker|heartbeat|manifest|tunnel|pipeline|\bLLM\b|\bAPI\b|OSRM|hash/i;
  for (const [slug, s] of Object.entries(spec)) {
    assert.equal(s.scenes.length, narr[slug].length, slug);
    assert.equal(s.scenes[0].kind, 'problem', slug); assert.match(narr[slug][0].de, /\?/, `${slug}: opens with a question`);
    assert.equal(s.scenes.at(-1).kind, 'close', slug);
    assert.equal(s.scenes.filter((x) => x.kind === 'close').length, 1, slug);
    for (const line of narr[slug]) for (const l of ['de', 'en']) assert.ok(!TECH.test(line[l]), `${slug}: ${line[l]}`);
    for (const sc of s.scenes.filter((x) => x.kind === 'step')) for (const shot of sc.shots) {
      if (shot.whole) continue;
      for (const fmt of ['H', 'V']) for (const en of ['', '-en']) {
        const k = shot.cut ?? 'mob';
        const base = shot.name && (rects[`${shot.name}-${k}${en}`] ? `${shot.name}-${k}${en}` : `${shot.name}-${k}`);
        const f0 = shot.r ?? rects[base]?.[shot.focus];
        assert.ok(f0, `${slug}: ${base}/${shot.focus}`);
        const f = shot.clip ? { ...f0, ...shot.clip } : f0;
        const size = shot.size ?? SIZES[k];
        const want = (fmt === 'V' ? shot.scaleV : undefined) ?? shot.scale ?? MIN_SCALE[fmt];
        const c = cropFor(f, size, BOX[fmt], want);
        assert.ok(c.scale >= want - 1e-9, `${slug}: ${base} scale ${c.scale}`);
        assert.ok(f.x + 1e-6 >= c.x && f.x + f.w <= c.x + c.w + 0.02, `${slug}/${fmt}: focus of ${base} wider than the crop`);
      }
    }
  }
});
