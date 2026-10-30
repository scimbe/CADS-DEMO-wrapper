// Untertitel demo, browser side (ES module, no build step). The video stays in this tab:
//
//  1. verify the signed template with the marketplace wasm (signature, trusted publisher, expiry),
//  2. fetch each component and compare its SHA-256 with the signed digest BEFORE it may run,
//  3. ffmpeg (wasm) reads the clip; whisper.cpp (wasm, in a worker) writes the text,
//  4. the person edits the cards; ffmpeg burns them in; .mp4 and .srt are offered from memory.
//
// There is deliberately no upload code here; test/untertitel.test.mjs keeps it that way.
import { FFmpeg } from '/static/vendor/untertitel/ffmpeg/index.js';
import { MAX_BYTES, COMPONENT_FILES, componentsFor, isSilent, checkFile, parseProbe, outputSize, wordsFromResult, groupCues, toSrt, toAss, burnArgs, isOutOfMemory } from '/pb/untertitel-core.mjs';
import { makeApi, inspectTemplate, shortDigest } from '/pb/prompt-core.mjs';

const root = document.getElementById('ut');
const S = JSON.parse(document.getElementById('ut-strings').textContent);
const VENDOR = '/static/vendor/untertitel/';
const MOBILE = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);
const $ = (id) => document.getElementById(id);
const fill = (s, v = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
const stepEl = $('ut-step'), bar = $('ut-bar'), msg = $('ut-msg'), errBox = $('ut-error'), cancelBtn = $('ut-cancel');

let trusted = null;   // { template, publisher, verified:Map(name->Blob) }
let job = null;       // { file, probe, ff, cues, cancelled, whisper }
const times = {};
const secs = (ms) => (ms / 1000).toFixed(1).replace('.', S.decimal);

class Stop extends Error { constructor(code, vars) { super(code); this.code = code; this.vars = vars; } }

function step(label, value = null) {
  $('ut-progress').hidden = false;
  stepEl.textContent = label;
  if (value === null) bar.removeAttribute('value'); else bar.value = value;
}
function showError(code, vars) {
  errBox.hidden = false;
  errBox.textContent = fill(S.err[code] ?? S.err.generic, vars);
  $('ut-progress').hidden = true;
  $('ut-go').disabled = !job?.file;
}
async function timed(name, fn) { const t0 = performance.now(); try { return await fn(); } finally { times[name] = performance.now() - t0; } }

// ---- trust: template first, then every byte that will execute ------------------------------------
async function loadTemplate() {
  const r = await fetch('/api/template/untertitel', { cache: 'no-store' });
  if (!r.ok) throw new Stop('template');
  const data = await r.json();
  const wasm = await import(root.dataset.wasmJs);
  await wasm.default({ module_or_path: root.dataset.wasmBin });
  const api = makeApi(wasm);
  const st = inspectTemplate(data.raw, { api, publishers: data.publishers, now: Math.floor(Date.now() / 1000) });
  if (!st.ok) throw new Stop('template');
  return { api, raw: data.raw, template: st.template, publisher: st.publisher, meta: data.meta };
}

async function fetchVerified(c, onBytes) {
  const file = COMPONENT_FILES[c.name];
  const r = await fetch(VENDOR + file).catch(() => null);
  if (!r || !r.ok) throw new Stop('download');
  const parts = [];
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (job?.cancelled) { await reader.cancel(); throw new Stop('cancelled'); }
    parts.push(value); onBytes(value.length);
  }
  const blob = new Blob(parts, { type: file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== c.sha256) throw new Stop('tampered', { name: c.name });
  return blob;
}

async function verifyAll(tpl, model) {
  const blobs = new Map();
  const total = Number(root.dataset['bytes' + model[0].toUpperCase() + model.slice(1)]);
  const wanted = componentsFor(model);
  const components = tpl.template.components.filter((c) => wanted.includes(c.name));
  if (components.length !== wanted.length) throw new Stop('template');
  let got = 0;
  await Promise.all(components.map(async (c) => {
    blobs.set(c.name, await fetchVerified(c, (n) => {
      got += n;
      step(fill(S.step.download, { mb: Math.round(got / 1e6), total: Math.round(total / 1e6) }), Math.min(1, got / total));
    }));
  }));
  const trust = $('ut-trust');
  trust.hidden = false;
  $('ut-trust-sum').textContent = fill(S.trust, { n: blobs.size, who: tpl.publisher.label?.[root.dataset.lang] ?? tpl.publisher.label?.de ?? '' });
  $('ut-trust-list').replaceChildren(...components.map((c) => {
    const li = document.createElement('li');
    li.textContent = `${c.name}  sha256:${shortDigest(c.sha256, 16)}`;
    return li;
  }));
  return blobs;
}

// ---- ffmpeg -----------------------------------------------------------------------------------------
async function startFfmpeg(blobs) {
  const ff = new FFmpeg();
  const log = [];
  ff.on('log', ({ message }) => { log.push(message); if (log.length > 40) log.shift(); });
  ff.log = log;
  // A worker that fails to start never rejects load(), so bound it instead of hanging forever.
  await Promise.race([ff.load({
    classWorkerURL: VENDOR + 'ffmpeg/worker.js',
    coreURL: URL.createObjectURL(blobs.get('ffmpeg-core-js')),
    wasmURL: URL.createObjectURL(blobs.get('ffmpeg-core-wasm')),
  }), new Promise((_, reject) => setTimeout(() => reject(new Error('ffmpeg start timed out')), 120000))]);
  await ff.createDir('/in'); await ff.createDir('/fonts');
  await ff.writeFile('/fonts/Poppins-ExtraBold.ttf', new Uint8Array(await blobs.get('untertitel-schrift').arrayBuffer()));
  await ff.mount('WORKERFS', { files: [new File([job.file], 'clip')] }, '/in');
  return ff;
}

async function probe(ff) {
  // ffprobe in this build answers -1 even on success, so the report itself is the only signal.
  await ff.ffprobe(['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', '/in/clip', '-o', '/probe.json']).catch(() => {});
  let json = null;
  try { json = JSON.parse(await ff.readFile('/probe.json', 'utf8')); } catch { /* no report: not a media file */ }
  const info = parseProbe(json);
  if (info.error) throw new Stop(info.error, { min: Math.ceil((info.duration ?? 0)) });
  return info;
}

async function readAudio(ff) {
  const rc = await ff.exec(['-i', '/in/clip', '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '/audio.pcm']);
  if (rc !== 0) throw new Stop('no-audio');
  const bytes = await ff.readFile('/audio.pcm');
  await ff.deleteFile('/audio.pcm');
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
}

// ---- whisper ------------------------------------------------------------------------------------------
function transcribe(blobs, model, pcm, lang) {
  return new Promise((resolve, reject) => {
    const w = new Worker('/static/untertitel-whisper.worker.js', { type: 'module' });
    job.whisper = w;
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.onmessage = ({ data: m }) => {
      if (m.type === 'progress') step(S.step.transcribe, m.percent > 0 ? m.percent / 100 : null); // the first stage reports nothing
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
      else { w.terminate(); resolve(m.result); }
    };
    const threads = Math.min(MOBILE ? 4 : 8, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
    w.postMessage({ runtime: blobs.get('whisper-runtime'), model, pcm, lang, threads }, [pcm.buffer]);
  });
}

// ---- edit -----------------------------------------------------------------------------------------------
function renderCues(cues) {
  const stamp = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  $('ut-cues').replaceChildren(...cues.map((c, i) => {
    const li = document.createElement('li');
    const lab = document.createElement('label'); lab.htmlFor = 'ut-c' + i; lab.textContent = stamp(c.start);
    const inp = document.createElement('input'); inp.id = 'ut-c' + i; inp.type = 'text'; inp.value = c.text; inp.maxLength = 120; inp.className = 'ut-cue';
    inp.addEventListener('input', () => { c.text = inp.value; });
    li.append(lab, inp);
    return li;
  }));
  $('ut-edit').hidden = false;
}

// ---- flow ---------------------------------------------------------------------------------------------
function values() {
  const v = { language: $('ut-language').value, model: $('ut-model').value, look: $('ut-look').value, position: $('ut-position').value };
  // The wasm renders with the signed bounds: a value outside them never reaches the pipeline.
  trusted.api.renderPromptTemplate(trusted.raw, JSON.stringify(v), Math.floor(Date.now() / 1000));
  return v;
}

async function run() {
  errBox.hidden = true;
  $('ut-result').hidden = true; $('ut-edit').hidden = true;
  $('ut-go').disabled = true; cancelBtn.hidden = false;
  job.cancelled = false;
  try {
    step(S.step.verify);
    const v = values();
    const blobs = await timed('prepare', () => verifyAll(trusted, v.model));
    job.blobs = blobs;
    step(S.step.read);
    const ff = job.ff = await startFfmpeg(blobs);
    job.probe = await probe(ff);
    const pcm = await timed('audio', () => readAudio(ff));
    if (isSilent(pcm)) throw new Stop('no-speech');
    step(S.step.transcribe);
    const result = await timed('transcribe', () => transcribe(blobs, blobs.get('whisper-model-' + v.model), pcm, v.language));
    const cues = groupCues(wordsFromResult(result));
    if (!cues.length) throw new Stop('no-speech');
    job.cues = cues;
    renderCues(cues);
    $('ut-progress').hidden = true;
    $('ut-times').textContent = fill(S.timesEdit, { prepare: secs(times.prepare), text: secs(times.audio + times.transcribe) });
    $('ut-edit-h').focus();
  } catch (e) { fail(e); } finally { cancelBtn.hidden = true; }
}

async function burn() {
  errBox.hidden = true;
  $('ut-burn').disabled = true; cancelBtn.hidden = false;
  try {
    const ff = job.ff;
    const v = values();
    const { width, height } = outputSize(job.probe.width, job.probe.height);
    await ff.writeFile('/subs.ass', new TextEncoder().encode(toAss(job.cues, { width, height, look: v.look, position: v.position })));
    const onProgress = ({ time }) => step(S.step.burn, Math.min(1, time / 1e6 / job.probe.duration));
    ff.on('progress', onProgress);
    step(S.step.burn, 0);
    const rc = await timed('burn', () => ff.exec(burnArgs({ input: '/in/clip', ass: '/subs.ass', fontsDir: '/fonts', width, height, audioCodec: job.probe.audioCodec, output: '/out.mp4' })));
    ff.off('progress', onProgress);
    if (rc !== 0) throw new Stop(ff.log.some((l) => isOutOfMemory(l)) ? 'memory' : 'burn');
    const data = await ff.readFile('/out.mp4');
    await ff.deleteFile('/out.mp4');
    const base = job.file.name.replace(/\.[^.]+$/, '') || 'video';
    const mp4 = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
    const srt = URL.createObjectURL(new Blob([toSrt(job.cues)], { type: 'application/x-subrip' }));
    $('ut-video').src = mp4;
    Object.assign($('ut-dl-mp4'), { href: mp4, download: `${base}-untertitel.mp4` });
    Object.assign($('ut-dl-srt'), { href: srt, download: `${base}.srt` });
    $('ut-progress').hidden = true;
    $('ut-result').hidden = false;
    $('ut-times').textContent = fill(S.timesDone, { prepare: secs(times.prepare), text: secs(times.audio + times.transcribe), burn: secs(times.burn), mb: (data.length / 1e6).toFixed(1).replace('.', S.decimal) });
    $('ut-dl-mp4').focus();
  } catch (e) { fail(e); } finally { cancelBtn.hidden = true; $('ut-burn').disabled = false; }
}

function fail(e) {
  if (job?.cancelled || e?.code === 'cancelled') { showError('cancelled'); return; }
  if (e instanceof Stop) { showError(e.code, e.vars); return; }
  console.error(e);
  showError(isOutOfMemory(e) ? 'memory' : 'generic');
}

function cancel() {
  if (!job) return;
  job.cancelled = true;
  job.whisper?.terminate();
  job.ff?.terminate();
  job.ff = null;
  fail(new Stop('cancelled'));
}

function pick(file) {
  errBox.hidden = true;
  $('ut-result').hidden = true; $('ut-edit').hidden = true; $('ut-times').textContent = '';
  job?.ff?.terminate();
  job = null;
  const bad = checkFile(file);
  if (bad) { $('ut-go').disabled = true; $('ut-picked').textContent = ''; showError(bad, { mb: Math.round(MAX_BYTES / 1048576) }); return; }
  job = { file };
  $('ut-picked').textContent = fill(S.picked, { name: file.name, mb: (file.size / 1e6).toFixed(1).replace('.', S.decimal) });
  $('ut-go').disabled = false;
}

function fillSelect(id, param, labels) {
  const sel = $(id);
  sel.replaceChildren(...param.options.map((o) => { const op = document.createElement('option'); op.value = o; op.textContent = labels?.options?.[o]?.[root.dataset.lang] ?? o; return op; }));
  if (labels?.default) sel.value = labels.default;
}

async function boot() {
  if (!globalThis.crossOriginIsolated || !globalThis.SharedArrayBuffer || !globalThis.WebAssembly || !crypto.subtle) { showError('browser'); $('ut-file').disabled = true; return; }
  try {
    trusted = await loadTemplate();
  } catch (e) { $('ut-file').disabled = true; showError('template'); return; }
  for (const p of trusted.template.parameters) fillSelect('ut-' + p.name, p, trusted.meta.params[p.name]);
  if (MOBILE) $('ut-model').value = 'schnell';
  $('ut-file').addEventListener('change', (e) => { if (e.target.files[0]) pick(e.target.files[0]); });
  $('ut-go').addEventListener('click', run);
  $('ut-burn').addEventListener('click', burn);
  cancelBtn.addEventListener('click', cancel);
  const drop = $('ut-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });
  root.dataset.ready = '1';
}
boot();
