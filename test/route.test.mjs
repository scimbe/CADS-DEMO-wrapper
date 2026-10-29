// travel ("Route planen (Bremen)"): the bridge client (lib/route.mjs) and the page + run route against
// a mock bridge. No real network: TRAVEL_BRIDGE_URL points the wrapper at a local fake.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createThrottle, proseOf, thinLine, summarizePlan, explainBridgeError, planRoute } from '../lib/route.mjs';

// The shape the live bridge answers with (trimmed: real responses carry ~190 points).
const coords = [[8.8135, 53.0831], [8.82, 53.08], [8.83, 53.07], [8.8377, 53.0664]];
const OK_BODY = (pass = true) => ({
  intent: { origin: 'Bremen Hauptbahnhof', destination: 'Bremen Weserstadion', preference: 'fastest', toolCallId: 'c1' },
  raw_osrm: { code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: coords }, distance: 4064.1, duration: 467 }] },
  picked_route: { geometry: { type: 'LineString', coordinates: coords }, legs: [], distance: 4064.1, duration: 467 },
  provenance: { engine: 'osrm-backend v5.25.0 / MLD', dataset: 'bremen-latest (md5 x)', preference: 'fastest' },
  llm_answer: '<ROUTE_FACTS>{"distance_m":4064,"duration_s":467}</ROUTE_FACTS>\n\nDie Route ist 4064 Meter lang.',
  verify: { pass, hardFails: pass ? [] : ['x'], checks: [{ name: 'facts.distance_m == round(raw.distance)', pass: true }, { name: 'facts.duration_s == round(raw.duration)', pass }] },
});

// ---- unit ----------------------------------------------------------------------------------------
test('throttle: calls start at least 1 s apart; a too-long queue is refused, not delayed forever', async () => {
  let t = 0; const waits = [];
  const slot = createThrottle({ minGapMs: 1000, maxWaitMs: 2500, now: () => t, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(await slot(), true);
  assert.equal(await slot(), true);
  assert.equal(await slot(), true);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(await slot(), null, 'would have to wait 3 s > maxWait');
  t = 10000; waits.length = 0;
  assert.equal(await slot(), true); assert.deepEqual(waits, []);
});

test('proseOf strips the ROUTE_FACTS block; thinLine keeps both ends and caps the points', () => {
  assert.equal(proseOf('<ROUTE_FACTS>{"a":1}</ROUTE_FACTS>\n\nText.'), 'Text.');
  const line = Array.from({ length: 1000 }, (_, i) => [8 + i / 1000, 53]);
  const th = thinLine(line, 50);
  assert.equal(th.length, 50);
  assert.deepEqual(th[0], line[0]); assert.deepEqual(th[49], line[999]);
  assert.deepEqual(thinLine([[1, 2], ['x', 3], null]), [[1, 2]]);
});

test('summarizePlan: numbers come from the picked OSRM route; only verify.pass===true counts as checked', () => {
  const s = summarizePlan(OK_BODY(true));
  assert.equal(s.render, 'route');
  assert.equal(s.distance_m, 4064); assert.equal(s.duration_s, 467);
  assert.equal(s.verified, true);
  assert.equal(s.text, 'Die Route ist 4064 Meter lang.');
  assert.equal(s.coords.length, 4);
  assert.equal(summarizePlan(OK_BODY(false)).verified, false);
  const noVerify = OK_BODY(true); delete noVerify.verify;
  assert.equal(summarizePlan(noVerify).verified, false, 'missing check is never a pass');
  assert.deepEqual(summarizePlan({}), { error: 'no-route' });
  assert.deepEqual(summarizePlan({ picked_route: { distance: 1, duration: 1, geometry: { coordinates: [[1, 2]] } } }), { error: 'no-route' });
});

test('bridge errors become specific sentences in DE and EN', () => {
  const g = explainBridgeError('de', 502, 'no geocode result for "Bremer Hauptbahnhof" within the Bremen bounding box');
  assert.match(g.msg, /^Ort nicht gefunden: „Bremer Hauptbahnhof“/);
  assert.match(g.msg, /Bremen Hauptbahnhof/);
  assert.match(explainBridgeError('en', 502, 'no geocode result for "X" within the Bremen bounding box').msg, /^Place not found: “X”/);
  assert.match(explainBridgeError('de', 502, 'model did not call plan_route — no route intent to act on').msg, /Start und Ziel wurden nicht erkannt/);
  assert.match(explainBridgeError('de', 502, 'OSRM query failed: NoRoute').msg, /keine Route gefunden/);
  assert.match(explainBridgeError('de', 502, 'Nominatim request failed: HTTP 429').msg, /Ortssuche ist gerade ausgelastet/);
  const llm = explainBridgeError('de', 502, 'LiteLLM request failed: HTTP 500 {"secret":"upstream"}');
  assert.match(llm.msg, /Sprachmodell ist gerade nicht erreichbar/);
  assert.ok(!llm.details.includes('upstream'), 'upstream LLM bodies stay out of the visitor log');
  assert.match(explainBridgeError('de', 503, 'LITELLM_BASE_URL/LITELLM_API_KEY not configured').msg, /Sprachmodell/);
});

test('planRoute: empty input never reaches the bridge; timeout, unreachable and garbage are honest failures', async () => {
  let called = 0;
  const never = async () => { called++; throw new Error('should not be called'); };
  const e = await planRoute({ bridgeUrl: 'http://x', text: '  ', fetchImpl: never });
  assert.equal(e.ok, false); assert.match(e.msg, /in einem Satz/); assert.equal(called, 0);
  const to = await planRoute({ bridgeUrl: 'http://x', text: 'Von A nach B', fetchImpl: async () => { const er = new Error('t'); er.name = 'TimeoutError'; throw er; } });
  assert.equal(to.ok, false); assert.match(to.msg, /nicht rechtzeitig/);
  const down = await planRoute({ bridgeUrl: 'http://x', text: 'Von A nach B', lang: 'en', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(down.ok, false); assert.match(down.msg, /not answering/);
  const html404 = await planRoute({ bridgeUrl: 'http://x', text: 'Von A nach B', fetchImpl: async () => new Response('<html>', { status: 404 }) });
  assert.equal(html404.ok, false); assert.match(html404.msg, /antwortet gerade nicht/);
  const empty200 = await planRoute({ bridgeUrl: 'http://x', text: 'Von A nach B', fetchImpl: async () => Response.json({}) });
  assert.equal(empty200.ok, false, 'a 200 without a route is no success');
  const busy = await planRoute({ bridgeUrl: 'http://x', text: 'Von A nach B', throttle: async () => null, fetchImpl: never });
  assert.equal(busy.ok, false); assert.match(busy.msg, /viele Besucher/); assert.equal(called, 0);
  let sent = null;
  const ok = await planRoute({ bridgeUrl: 'http://x/', text: 'Von A nach B', fetchImpl: async (u, o) => { sent = { u, body: JSON.parse(o.body) }; return Response.json(OK_BODY(true)); } });
  assert.equal(ok.ok, true); assert.equal(sent.u, 'http://x/api/plan'); assert.deepEqual(sent.body, { text: 'Von A nach B' });
});

// ---- integration: wrapper + mock bridge ------------------------------------------------------------
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
let bridge, hits = [], base, proc, gated, gbase;
function startWrapper(port, env) {
  const p = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 8000);
    p.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) { clearTimeout(to); resolve(p); } });
    p.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
}
before(async () => {
  bridge = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const text = (() => { try { return JSON.parse(b).text; } catch { return null; } })();
      hits.push({ t: Date.now(), path: req.url, text });
      const send = (code, o) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      if (req.url !== '/api/plan' || req.method !== 'POST') return send(404, { error: 'not found' });
      if (/Bremer Hauptbahnhof/.test(text)) return send(502, { error: 'no geocode result for "Bremer Hauptbahnhof" within the Bremen bounding box' });
      if (/falsch/.test(text)) return send(200, OK_BODY(false));
      return send(200, OK_BODY(true));
    });
  });
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  const burl = `http://127.0.0.1:${bridge.address().port}`;
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  proc = await startWrapper(port, { TRAVEL_BRIDGE_URL: burl });
  const gport = await freePort(); gbase = `http://127.0.0.1:${gport}`;
  gated = await startWrapper(gport, { TRAVEL_BRIDGE_URL: burl, DEMO_AUTH_MODE: 'gate', DEMO_GATE_HOST: 'demos.example.test', DEMO_GATE_CHECK_URL: 'http://127.0.0.1:9/gate/check' });
});
after(() => { for (const p of [proc, gated]) if (p) p.kill(); if (bridge) bridge.close(); });

const run = async (b, text, lang = 'de') => {
  const cfg = Buffer.from(JSON.stringify({ text })).toString('base64');
  const r = await fetch(`${b}/api/start?demo=travel&lang=${lang}&cfg=${encodeURIComponent(cfg)}`);
  return { status: r.status, body: await r.text() };
};
const events = (sse) => sse.split('\n\n').filter(Boolean).map((blk) => {
  const ev = (blk.match(/^event: (.*)$/m) || [])[1]; const data = (blk.match(/^data: (.*)$/m) || [])[1];
  return { ev, data: data ? JSON.parse(data) : null };
});

test('/d/travel: input, clickable examples, one button, a hidden result panel with map and check badge (DE + EN)', async () => {
  for (const lang of ['de', 'en']) {
    const h = await (await fetch(`${base}/d/travel?lang=${lang}`)).text();
    assert.match(h, /<input id="rttext"[^>]*class="descinput/);
    assert.ok((h.match(/class="exchip rtex"/g) || []).length >= 2, 'at least two examples');
    assert.equal((h.match(/<button class="btn btn-primary run"/g) || []).length, 1);
    assert.match(h, /<section class="panel res-route" hidden>/);
    assert.match(h, /class="rt-map"/); assert.match(h, /class="rt-badge"/);
    assert.match(h, /OpenStreetMap/);
  }
  const de = await (await fetch(`${base}/d/travel`)).text();
  assert.match(de, />Von Bremen Hauptbahnhof nach Bremen Weserstadion</);
  assert.match(de, /Route planen ▸/);
  const en = await (await fetch(`${base}/d/travel?lang=en`)).text();
  assert.match(en, /Plan route ▸/); assert.match(en, /written in German/);
});

test('a run returns the real numbers, the text without the facts block and verified=true', async () => {
  hits = [];
  const r = await run(base, 'Von Bremen Hauptbahnhof nach Bremen Weserstadion');
  assert.equal(r.status, 200);
  const ev = events(r.body);
  const res = ev.find((e) => e.ev === 'result');
  assert.ok(res, 'result event');
  assert.equal(res.data.render, 'route');
  assert.equal(res.data.distance_m, 4064); assert.equal(res.data.duration_s, 467);
  assert.equal(res.data.verified, true);
  assert.ok(!res.data.text.includes('ROUTE_FACTS'));
  assert.ok(ev.some((e) => e.ev === 'stage' && e.data.id === 'done'));
  assert.deepEqual(hits.map((h) => h.text), ['Von Bremen Hauptbahnhof nach Bremen Weserstadion']);
});

test('a failed check is shown as such (verified=false + warning), never as a pass', async () => {
  const ev = events((await run(base, 'falsch geprüft')).body);
  assert.equal(ev.find((e) => e.ev === 'result').data.verified, false);
  assert.ok(ev.some((e) => e.ev === 'warn' && /NICHT bestanden/.test(e.data.text)));
});

test('unknown place: friendly plain message, no result event, error stage', async () => {
  const ev = events((await run(base, 'Vom Bremer Hauptbahnhof zum Weserstadion')).body);
  const fail = ev.find((e) => e.ev === 'fail');
  assert.ok(fail); assert.equal(fail.data.plain, true);
  assert.match(fail.data.text, /^Ort nicht gefunden: „Bremer Hauptbahnhof“.*„Bremen Hauptbahnhof“/);
  assert.ok(!ev.some((e) => e.ev === 'result'));
  assert.ok(ev.some((e) => e.ev === 'stage' && e.data.id === 'error'));
  const en = events((await run(base, 'Vom Bremer Hauptbahnhof zum Weserstadion', 'en')).body);
  assert.match(en.find((e) => e.ev === 'fail').data.text, /^Place not found/);
});

test('empty input is refused before the bridge is called', async () => {
  hits = [];
  const ev = events((await run(base, '')).body);
  assert.match(ev.find((e) => e.ev === 'fail').data.text, /in einem Satz/);
  assert.equal(hits.length, 0);
});

test('two runs back to back reach the bridge at least ~1 s apart (throttle per process)', async () => {
  hits = [];
  await Promise.all([run(base, 'Von A Bremen nach B Bremen'), run(base, 'Von C Bremen nach D Bremen')]);
  assert.equal(hits.length, 2);
  assert.ok(Math.abs(hits[1].t - hits[0].t) >= 950, `gap ${hits[1].t - hits[0].t} ms`);
});

test('DEMO_AUTH_MODE=gate: a run without login is 401 and never reaches the bridge; the page stays public', async () => {
  hits = [];
  const r = await run(gbase, 'Von Bremen Hauptbahnhof nach Bremen Weserstadion');
  assert.equal(r.status, 401);
  assert.equal(JSON.parse(r.body).error, 'login-required');
  assert.equal(hits.length, 0);
  assert.equal((await fetch(`${gbase}/d/travel`)).status, 200);
});
