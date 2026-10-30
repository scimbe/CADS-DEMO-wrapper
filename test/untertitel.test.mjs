// /d/untertitel: pure caption logic, the supply chain (provenance <-> signature <-> Dockerfile), the
// strict page headers, and the promise that the page has no way to send a video anywhere.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { wasm, nowSec } from '../lib/prompt-wasm.mjs';
import { inspectTemplate } from '../lib/prompt-core.mjs';
import { MAX_BYTES, MAX_SECONDS, COMPONENT_FILES, componentsFor, checkFile, parseProbe, outputSize, wordsFromResult, groupCues, toSrt, toAss, burnArgs, cleanCue, isOutOfMemory } from '../lib/untertitel-core.mjs';
import { UT_DIR, UT_PAGE_HEADERS, untertitelStrings, downloadBytes } from '../lib/untertitel-page.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const PROV = JSON.parse(readFileSync(join(UT_DIR, 'PROVENANCE.json'), 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [relative(UT_DIR, p)]; });

test('checkFile refuses before anything is downloaded', () => {
  assert.equal(checkFile({ name: 'a.mp4', size: 0, type: 'video/mp4' }), 'empty');
  assert.equal(checkFile({ name: 'a.mp4', size: MAX_BYTES + 1, type: 'video/mp4' }), 'too-big');
  assert.equal(checkFile({ name: 'a.pdf', size: 10, type: 'application/pdf' }), 'not-video');
  assert.equal(checkFile({ name: 'a', size: 10, type: '' }), 'not-video');
  assert.equal(checkFile({ name: 'a.mov', size: 10, type: '' }), null);
  assert.equal(checkFile({ name: 'a.mp4', size: 10, type: 'video/mp4' }), null);
});

test('parseProbe: no video, no audio, too long, and a rotated phone clip', () => {
  const v = { codec_type: 'video', width: 1920, height: 1080 };
  const a = { codec_type: 'audio', codec_name: 'aac' };
  assert.equal(parseProbe(null).error, 'not-video');
  assert.equal(parseProbe({ streams: [a], format: { duration: '3' } }).error, 'not-video');
  assert.equal(parseProbe({ streams: [{ ...v, disposition: { attached_pic: 1 } }, a], format: { duration: '3' } }).error, 'not-video', 'cover art is no video');
  assert.equal(parseProbe({ streams: [v], format: { duration: '3' } }).error, 'no-audio');
  assert.equal(parseProbe({ streams: [v, a], format: { duration: String(MAX_SECONDS + 1) } }).error, 'too-long');
  const rot = parseProbe({ streams: [{ ...v, side_data_list: [{ rotation: -90 }] }, a], format: { duration: '3' } });
  assert.deepEqual([rot.width, rot.height, rot.audioCodec], [1080, 1920, 'aac']);
});

test('outputSize caps the short side, stays even, never enlarges', () => {
  assert.deepEqual(outputSize(1080, 1920), { width: 720, height: 1280 });
  assert.deepEqual(outputSize(1920, 1080), { width: 1280, height: 720 });
  assert.deepEqual(outputSize(480, 854), { width: 480, height: 854 });
  assert.deepEqual(outputSize(1081, 1921), { width: 720, height: 1280 });
});

const tok = (text, from, to) => ({ text, offsets: { from, to } });
test('wordsFromResult joins tokens into words and drops special tokens and noise', () => {
  const words = wordsFromResult({ transcription: [{ tokens: [tok('[_BEG_]', 0, 0), tok(' ze', 1000, 1070), tok('ige', 1160, 1350), tok(' euch', 1570, 1850), tok(',', 1850, 1890), tok(' [Musik]', 2000, 2500), tok('[_TT_262]', 2600, 2600)] }] });
  assert.deepEqual(words, [{ start: 1, end: 1.35, text: 'zeige' }, { start: 1.57, end: 1.89, text: 'euch,' }]);
  assert.deepEqual(wordsFromResult({}), []);
});

test('groupCues breaks on punctuation, length, word count and pauses', () => {
  const w = (text, start, end = start + 0.3) => ({ text, start, end });
  const texts = (a) => groupCues(a).map((c) => c.text);
  assert.deepEqual(texts([w('Hallo,', 0), w('du', 0.4), w('da', 0.8)]), ['Hallo,', 'du da']);
  assert.deepEqual(texts([w('a', 0), w('b', 0.4), w('c', 0.8), w('d', 1.2), w('e', 1.6)]), ['a b c d', 'e']);
  assert.deepEqual(texts([w('eins', 0), w('zwei', 3)]), ['eins', 'zwei']);
  assert.deepEqual(texts([w('Donaudampfschifffahrt', 0), w('Gesellschaft', 0.4)]), ['Donaudampfschifffahrt', 'Gesellschaft']);
  assert.deepEqual(groupCues([]), []);
});

test('toSrt numbers cues, formats time and skips what the person emptied', () => {
  assert.equal(toSrt([{ start: 0, end: 1.5, text: 'Hallo' }, { start: 2, end: 3, text: '  ' }, { start: 61.25, end: 62, text: 'für <b>dich</b>' }]),
    '1\n00:00:00,000 --> 00:00:01,500\nHallo\n\n2\n00:01:01,250 --> 00:01:02,000\nfür bdich/b\n');
});

test('toAss: size, position, karaoke timing and no way to inject override tags', () => {
  const ass = toAss([{ start: 1, end: 2, text: 'ab cd{\\pos(0,0)}' }], { width: 720, height: 1280, look: 'pop', position: 'oben' });
  assert.match(ass, /PlayResX: 720\nPlayResY: 1280/);
  assert.match(ass, /Style: Cap,Poppins ExtraBold,59,/);
  assert.match(ass, /,8,43,43,205,1\n/, 'alignment 8 = top');
  assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:02\.00,Cap,,0,0,0,,\{\\k17\}ab \{\\k83\}cdpos\(0,0\)/);
  assert.doesNotMatch(toAss([{ start: 0, end: 1, text: 'a b' }], { width: 720, height: 1280, look: 'klar', position: 'mitte' }), /\\k/);
  assert.equal(cleanCue(' a\n b '), 'a b');
});

test('burnArgs copies AAC and re-encodes anything else', () => {
  const a = { input: '/in/clip', ass: '/s.ass', fontsDir: '/fonts', width: 720, height: 1280, output: '/o.mp4' };
  assert.deepEqual(burnArgs({ ...a, audioCodec: 'aac' }).slice(-5, -2), ['-c:a', 'copy', '-movflags']);
  assert.ok(burnArgs({ ...a, audioCodec: 'opus' }).join(' ').includes('-c:a aac'));
  assert.ok(burnArgs({ ...a, audioCodec: 'aac' }).includes('scale=720:1280,subtitles=/s.ass:fontsdir=/fonts'));
});

test('isOutOfMemory recognises the wasm disguises only', () => {
  assert.ok(isOutOfMemory(new RangeError('WebAssembly.Memory(): could not allocate memory')));
  assert.ok(isOutOfMemory('memory access out of bounds'));
  assert.ok(!isOutOfMemory(new Error('boom')));
});

test('every vendored file is listed; big files are fetched by the Dockerfile with the same digest', () => {
  const onDisk = walk(UT_DIR).filter((n) => n !== 'PROVENANCE.json').sort();
  const gitTracked = Object.keys(PROV.files).filter((n) => !PROV.files[n].url).sort();
  assert.deepEqual(onDisk.filter((n) => !PROV.files[n]), [], 'unlisted vendored file');
  for (const n of gitTracked) assert.equal(sha256(readFileSync(join(UT_DIR, n))), PROV.files[n].sha256, n);
  const docker = read('Dockerfile');
  for (const [n, m] of Object.entries(PROV.files).filter(([, m]) => m.url)) {
    assert.ok(docker.includes(`--checksum=sha256:${m.sha256}`), `${n}: digest not in Dockerfile`);
    assert.ok(docker.includes(m.url), `${n}: url not in Dockerfile`);
    if (existsSync(join(UT_DIR, n))) assert.equal(sha256(readFileSync(join(UT_DIR, n))), m.sha256, n);
  }
});

test('licences of everything shipped are named', () => {
  assert.deepEqual(Object.values(PROV.sources).map((s) => s.license).sort(), ['GPL-2.0-or-later', 'MIT', 'MIT', 'MIT', 'OFL-1.1']);
  assert.ok(existsSync(join(UT_DIR, 'LICENSE.shout.txt')) && existsSync(join(UT_DIR, 'LICENSE.poppins-ofl.txt')));
  assert.match(PROV.sources['ffmpeg-core.js + ffmpeg-core.wasm'].source_code, /^https:\/\/github\.com\/ffmpegwasm/);
});

test('the signed template binds exactly the files the page runs', () => {
  const raw = read('templates/untertitel.json');
  const publishers = JSON.parse(read('templates/publishers.json'));
  const st = inspectTemplate(raw, { api: wasm(), publishers, now: nowSec() });
  assert.equal(st.ok, true, st.code);
  assert.deepEqual(st.template.components.map((c) => c.name).sort(), Object.keys(COMPONENT_FILES).sort());
  for (const c of st.template.components) assert.equal(c.sha256, PROV.files[COMPONENT_FILES[c.name]].sha256, c.name);
  const swapped = JSON.parse(raw);
  swapped.components[0].sha256 = '0'.repeat(64);
  assert.equal(inspectTemplate(JSON.stringify(swapped), { api: wasm(), publishers, now: nowSec() }).code, 'bad-signature', 'a changed digest breaks the signature');
});

test('the browser code contains no upload path', () => {
  for (const f of ['static/untertitel.js', 'static/untertitel-whisper.worker.js', 'lib/untertitel-core.mjs']) {
    const src = read(f);
    assert.doesNotMatch(src, /method\s*:|XMLHttpRequest|sendBeacon|WebSocket|RTCPeerConnection|FormData|<form/i, f);
    assert.doesNotMatch(src, /https?:\/\//, `${f}: no foreign host`);
  }
  const fetches = [...read('static/untertitel.js').matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1].split(',')[0].trim());
  assert.deepEqual(fetches, ["'/api/template/untertitel'", 'VENDOR + file']);
});

test('a run loads one speech model, the chosen one', () => {
  assert.ok(componentsFor('schnell').includes('whisper-model-schnell') && !componentsFor('schnell').includes('whisper-model-genau'));
  assert.equal(componentsFor('genau').length, Object.keys(COMPONENT_FILES).length - 1);
  assert.ok(downloadBytes('genau') > downloadBytes('schnell'));
});

test('German and English strings have the same shape', () => {
  const shape = (o) => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? shape(v).map((x) => `${k}.${x}`) : [k])).sort();
  assert.deepEqual(shape(untertitelStrings('en')), shape(untertitelStrings('de')));
  assert.notEqual(untertitelStrings('en').err['no-audio'], untertitelStrings('de').err['no-audio']);
});

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
let srv;
after(() => srv?.kill());
test('the page is public, isolated and locked down; other pages stay as they were', async () => {
  const port = await freePort();
  srv = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', DEMO_AUTH_MODE: 'gate', DEMO_GATE_HOST: 'demos.example.org', DEMO_GATE_CHECK_URL: 'http://127.0.0.1:9/gate' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { srv.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) resolve(); }); srv.on('exit', (c) => reject(new Error('exit ' + c))); });
  const base = `http://127.0.0.1:${port}`;
  for (const lang of ['de', 'en']) {
    const r = await fetch(`${base}/d/untertitel?lang=${lang}`);
    assert.equal(r.status, 200, 'no login');
    assert.equal(r.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /form-action 'none'/);
    const h = await r.text();
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
    assert.match(h, new RegExp(`${Math.round(downloadBytes('genau') / 1e6)} MB`), 'first-start download is stated');
    assert.match(h, lang === 'en' ? /Runs in your browser/ : /Läuft in deinem Browser/);
    assert.doesNotMatch(h, /Demo auf unserem Server|Demo on our server/);
  }
  assert.equal((await fetch(`${base}/d/phototools`)).headers.get('cross-origin-embedder-policy'), null);
  const worker = await fetch(`${base}/static/vendor/untertitel/ffmpeg/worker.js`);
  assert.equal(worker.headers.get('cross-origin-embedder-policy'), 'require-corp', 'a worker without COEP never starts in an isolated page');
  assert.equal((await fetch(`${base}/static/untertitel-whisper.worker.js`)).headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal((await fetch(`${base}/static/vendor/untertitel/..%2f..%2f..%2fserver.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/static/vendor/untertitel/shout.wasm.js`, { method: 'POST', body: 'x' })).status, 404, 'nothing accepts data here');
  assert.equal((await fetch(`${base}/pb/untertitel-core.mjs`)).status, 200);
  assert.equal((await fetch(`${base}/api/template/untertitel`)).status, 200);
  assert.match(await (await fetch(`${base}/`)).text(), /href="\/d\/untertitel"/);
});
