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
    if (d.type === 'external' && d.live) continue; // external apps have no /d page
    if (!/^[a-z0-9-]+$/.test(slug)) continue;      // the router only serves [a-z0-9-] slugs (not-live, never linked)
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
