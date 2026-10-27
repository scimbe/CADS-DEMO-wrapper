// erklaervideo: the gallery wiring around the bundle (manifests/erklaervideo): protocol parser, the
// card/page, the demo staying honest without TTS, and a full offline run with the bundle's stub backend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { parseBundleLine } from '../lib/bundle-lines.mjs';

const DEMOS = JSON.parse(readFileSync(new URL('../demos.json', import.meta.url), 'utf8'));
const MD = new URL('../manifests/erklaervideo/', import.meta.url);
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function boot(extraEnv = {}) {
  const port = await freePort();
  const proc = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', ...extraEnv }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 8000);
    proc.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) { clearTimeout(to); resolve(); } });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
  return { proc, base: `http://127.0.0.1:${port}` };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

test('bundle protocol lines parse; garbage does not', () => {
  assert.deepEqual(parseBundleLine('PROGRESS {"stage":"script","pct":15,"message":"Größe"}'), { kind: 'PROGRESS', data: { stage: 'script', pct: 15, message: 'Größe' } });
  assert.equal(parseBundleLine('RESULT {"duration_s":56.3}').kind, 'RESULT');
  assert.equal(parseBundleLine('ERROR {"code":"x","message":"y"}').kind, 'ERROR');
  for (const bad of ['', 'PROGRESS nope', 'PROGRESS {broken', 'WARN {"a":1}', 'random stderr line']) assert.equal(parseBundleLine(bad), null, bad);
});

test('manifest: bundle sha256 matches, card is live and visible', () => {
  const m = JSON.parse(readFileSync(new URL('manifest.json', MD), 'utf8'));
  assert.equal(m.name, 'erklaervideo');
  assert.equal(m.bundle.sha256, createHash('sha256').update(readFileSync(new URL('bundle.tar.gz', MD))).digest('hex'));
  const d = DEMOS.erklaervideo;
  assert.equal(d.live, true); assert.ok(!d.hidden); assert.equal(d.manifestDir, 'manifests/erklaervideo'); assert.equal(d.hasManifest, true);
});

test('page: video player, download, subtitles, no language switch for the voice', async () => {
  const { proc, base } = await boot();
  try {
    const home = await (await fetch(base + '/')).text();
    assert.match(home, /href="\/d\/erklaervideo"/);
    const de = await (await fetch(base + '/d/erklaervideo')).text();
    for (const needle of ['id="tvtext"', 'id="tvfile"', 'id="tvtitle"', 'class="resvideo"', 'dlvideo', 'dlsubs', 'maxlength="4000"']) assert.ok(de.includes(needle), needle);
    assert.ok(!/id="tvlang"/.test(de), 'no EN voice option until an English voice exists');
    const en = await (await fetch(base + '/d/erklaervideo?lang=en')).text();
    assert.match(en, /German for now/);
  } finally { proc.kill(); }
});

test('without TTS wiring the run fails honestly (no fake video)', async () => {
  const { proc, base } = await boot();
  try {
    const t = await (await fetch(`${base}/api/start?demo=erklaervideo&cfg=${encodeURIComponent(b64({ text: 'Ein Text mit genug Zeichen für die Eingabeprüfung der Demo.', length: 30 }))}`)).text();
    assert.match(t, /event: fail/);
    assert.ok(!/event: result/.test(t));
  } finally { proc.kill(); }
});

test('too short text is refused before anything runs', async () => {
  const { proc, base } = await boot();
  try {
    const t = await (await fetch(`${base}/api/start?demo=erklaervideo&cfg=${encodeURIComponent(b64({ text: 'kurz' }))}`)).text();
    assert.match(t, /mindestens 40 Zeichen/);
  } finally { proc.kill(); }
});

const haveTools = ['ffmpeg', 'magick', 'ffprobe'].every((x) => spawnSync('which', [x]).status === 0);
test('full run through SSE with the stub backend: progress, result, playable files', { skip: !haveTools && 'ffmpeg/ImageMagick missing' }, async () => {
  const { proc, base } = await boot({ EVGEN_TTS_BACKEND: 'stub', EVGEN_STUB_SCRIPT: '1' });
  try {
    const t = await (await fetch(`${base}/api/start?demo=erklaervideo&cfg=${encodeURIComponent(b64({ text: 'Ein Text mit genug Zeichen für die Eingabeprüfung der Demo.', length: 30, title: 'Größe' }))}`)).text();
    assert.match(t, /event: step\ndata: \{"text":"Skript aus deinem Text"\}/);
    assert.match(t, /event: run\ndata: \{"text":" *\d+ %/);
    const res = JSON.parse(/event: result\ndata: (.*)\n/.exec(t)[1]);
    assert.equal(res.render, 'textvideo');
    for (const k of ['video', 'poster', 'subtitles']) {
      const r = await fetch(base + res[k]);
      assert.equal(r.status, 200, k);
      const buf = Buffer.from(await r.arrayBuffer());
      assert.ok(buf.length > (k === 'subtitles' ? 50 : 1000), k);
      if (k === 'subtitles') assert.match(buf.toString('utf8'), /^WEBVTT[\s\S]*Größe, Rückseite und schwächer/);
    }
    assert.equal((await fetch(base + res.video)).headers.get('content-type'), 'video/mp4');
  } finally { proc.kill(); }
});
