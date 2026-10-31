// Integration: boot the real server WITHOUT any .env / LiteLLM credentials and make sure the
// gallery and every demo page still render (the LLM is only needed once a demo is run).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';

const DEMOS = JSON.parse(readFileSync(new URL('../demos.json', import.meta.url), 'utf8'));
let proc, base;

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 8000);
    proc.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) { clearTimeout(to); resolve(); } });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
});
after(() => { if (proc) proc.kill(); });

test('GET / renders in DE and EN (?lang=)', async () => {
  for (const [q, lang] of [['', 'de'], ['?lang=en', 'en'], ['?lang=fr', 'de']]) {
    const r = await fetch(base + '/' + q);
    assert.equal(r.status, 200);
    const h = await r.text();
    assert.match(h, new RegExp(`<html lang="${lang}"`));
    assert.ok(!h.includes('[object Object]'));
  }
});

test('every /d/<slug> page renders (DE+EN); demos that are not live show an in-preparation page', async () => {
  for (const [slug, d] of Object.entries(DEMOS)) {
    if (d.type === 'external' && d.live) continue; // external apps redirect (tested below)
    for (const lang of ['de', 'en']) {
      const r = await fetch(`${base}/d/${slug}?lang=${lang}`);
      assert.equal(r.status, 200, `${slug} ${lang}`);
      const h = await r.text();
      assert.match(h, new RegExp(`<html lang="${lang}"`), slug);
      assert.equal((h.match(/<main /g) || []).length, 1, `${slug}: exactly one <main>`);
      assert.equal((h.match(/<h1[ >]/g) || []).length, 1, `${slug}: exactly one <h1>`);
      if (d.live) assert.match(h, /<noscript>/, `${slug}: noscript fallback`);
      assert.ok(!/lokal aktiv|served by customer/.test(h), slug);
      if (d.live) assert.match(h, /data-timeout="\d+"/, `${slug}: client timeout configured`);
    }
  }
});

test('unknown demo -> 404, existing endpoints still answer', async () => {
  assert.equal((await fetch(base + '/d/does-not-exist')).status, 404);
  const st = await (await fetch(base + '/api/status')).json();
  assert.equal(typeof st.ok, 'boolean');
  if (!st.ok) assert.ok(st.reason, 'a failed status says why');
  const plan = await fetch(base + '/api/plan?demo=nope', { method: 'POST', body: '{}' });
  assert.equal(plan.status, 404);
});

test('/api/start rejects an unknown demo', async () => {
  const r = await fetch(base + '/api/start?demo=does-not-exist');
  assert.equal(r.status, 404);
});

test('/d/<slug> of a live external demo redirects to its externalUrl', async () => {
  for (const [slug, d] of Object.entries(DEMOS)) {
    if (!(d.type === 'external' && d.live)) continue;
    const r = await fetch(`${base}/d/${slug}`, { redirect: 'manual' });
    assert.equal(r.status, 302, slug);
    assert.equal(r.headers.get('location'), d.externalUrl, slug);
  }
});

test('sound_generation is retired (no backend): no card, no placeholder page, the old link goes to the overview', async () => {
  assert.ok(!('sound_generation' in DEMOS) && !('explainer' in DEMOS));
  const r = await fetch(`${base}/d/sound_generation?lang=en`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/?lang=en');
  assert.equal((await fetch(`${base}/d/sound_generation`, { redirect: 'manual' })).headers.get('location'), '/');
  assert.equal((await fetch(`${base}/d/constructor`, { redirect: 'manual' })).status, 404, 'prototype keys are no demos');
});

test('demos.json has no absolute paths and no cookbook', () => {
  const txt = readFileSync(new URL('../demos.json', import.meta.url), 'utf8');
  assert.ok(!/"\/(private|Users|Applications|tmp)\b/.test(txt), 'absolute path in demos.json');
  assert.ok(!('cookbook' in DEMOS));
});

test('podcast and explainer were merged: /d/<old> redirects to /d/erklaervideo (query kept), cards are hidden', async () => {
  for (const old of ['podcast', 'explainer']) {
    const r = await fetch(`${base}/d/${old}?lang=en`, { redirect: 'manual' });
    assert.equal(r.status, 302, old);
    assert.equal(r.headers.get('location'), '/d/erklaervideo?lang=en');
  }
  const home = await (await fetch(base + '/')).text();
  assert.ok(!/href="\/d\/(podcast|explainer|sound_generation)/.test(home));
});

test('travel is a visible gallery card that links to its own route page, not to the bare bridge', async () => {
  const home = await (await fetch(base + '/')).text();
  assert.match(home, /href="\/d\/travel"/);
  assert.ok(!home.includes('travel-34a13a96.bunsenbrenner.org'), 'the card must not point at the bridge (GET / there is 404)');
  const r = await fetch(`${base}/d/travel`, { redirect: 'manual' });
  assert.equal(r.status, 200);
});

test('erklaervideo without the bundle fails honestly (no fake success)', async () => {
  const cfg = Buffer.from(JSON.stringify({ text: 'x'.repeat(60), length: 60 })).toString('base64');
  const r = await fetch(`${base}/api/start?demo=erklaervideo&cfg=${encodeURIComponent(cfg)}`);
  const t = await r.text();
  assert.match(t, /event: fail/);
  assert.ok(!/event: result/.test(t));
});

// A single anonymous GET must never take the process down: every line here killed the server once
// (ReferenceError staticDir, EISDIR from a directory, a cfg that decodes to null).
test('URLs that used to crash the server answer normally and leave it running', async () => {
  const alive = async () => assert.equal((await fetch(base + '/')).status, 200);
  const cases = [
    ['/d/podcast/out/chapters.json', 200], ['/d/podcast/out/missing.mp3', 404], ['/d/explainer/out/renders/final.mp4', 404],
    ['/assets/thumbs/', 404], ['/assets/thumbs/photo1.jpg', 200], ['/d/podcast/out/renders', 404], ['/d/explainer/out/renders', 404], ['/d/sound_generation/out/x.mp3', 404],
  ];
  for (const [path, status] of cases) {
    const r = await fetch(base + path); await r.arrayBuffer();
    assert.equal(r.status, status, path);
    await alive();
  }
  const r = await fetch(`${base}/api/start?demo=diagram&cfg=${Buffer.from('null').toString('base64')}`);
  await r.body?.cancel();
  await alive();
});

test('names of Object.prototype are not demos', async () => {
  for (const slug of ['constructor', '__proto__']) {
    const r = await fetch(`${base}/d/${slug}`, { redirect: 'manual' });
    assert.equal(r.status, 404, slug);
    assert.equal(r.headers.get('location'), null, slug);
  }
});

// The run client against a login gate: fetch is stubbed, the rest is the code the page really ships.
test('a run without login says so and links the login, it does not claim a broken connection', async () => {
  const h = await (await fetch(`${base}/d/diagram`)).text();
  const src = h.slice(h.indexOf('function postStream('), h.indexOf('function startRun('));
  const events = [];
  const fetchStub = async (url, opt) => {
    events.push(['req', opt && opt.method || 'GET']);
    return { ok: false, json: async () => ({ message: 'Bitte anmelden.', login_url: 'https://bunsenbrenner.org/gate/start' }) };
  };
  const api = new Function('fetch', 'AbortController', `${src}; return postStream('/api/start?demo=diagram', null);`)(fetchStub, AbortController);
  for (const t of ['fail', 'stage', 'done']) api.addEventListener(t, (e) => events.push([t, JSON.parse(e.data)]));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(events[0], ['req', 'GET']);
  assert.deepEqual(events[1], ['fail', { text: 'Bitte anmelden.', login_url: 'https://bunsenbrenner.org/gate/start' }]);
  assert.equal(api.refused, true);
});

test('diagram without a description asks for one instead of drawing a stored example', async () => {
  const r = await fetch(`${base}/api/start?demo=diagram`);
  const t = await r.text();
  assert.match(t, /event: fail/); assert.ok(!t.includes('event: result'));
});

test('the diagram card describes what really runs (Graphviz, SVG)', () => {
  const d = DEMOS.diagram;
  for (const k of ['tagline', 'tagline_en', 'tech', 'tech_en']) { assert.doesNotMatch(d[k], /Mermaid|PNG/, k); assert.match(d[k], /Graphviz/, k); }
});

test('sample contract: the promised duration and the client timeout fit the real 75 s run', () => {
  assert.ok(DEMOS.contractcheck.estSeconds >= 60);
});

test('the report panel has a visible place for the fallback notice', async () => {
  assert.match(await (await fetch(`${base}/d/newsletter`)).text(), /class="note rep-fallback"/);
});

test('a broken PDF gets a sentence, no tool output and no server path', async () => {
  const bad = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 kaputt').toString('base64');
  const r = await fetch(`${base}/api/upload-compare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: bad, b: bad }) });
  const j = await r.json();
  assert.equal(r.status, 422); assert.doesNotMatch(j.error, /\/|Syntax|exit|Traceback/);
});

test('contractcheck gets the configured model under the name it reads (LLM_MODEL_NAME)', () => {
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const llm = readFileSync(new URL('../manifests/contractcheck/manifest.json', import.meta.url), 'utf8') && src.slice(src.indexOf('function invokeReportMd'), src.indexOf('// ---- invoke: image'));
  assert.match(llm, /LLM_MODEL_NAME:/); assert.doesNotMatch(llm, /LLM_MODEL:/);
});
