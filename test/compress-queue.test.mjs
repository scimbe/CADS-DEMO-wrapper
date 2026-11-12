// Staging findings L4/L8: compressing every part at boot filled the libuv thread pool, so the gate check's DNS lookup timed
// out (503 for ~15 s after a start) and process.exit waited for all running jobs (docker stop up to its 10 s kill).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCompressedFiles, createJobQueue } from '../lib/compress.mjs';

const tick = () => new Promise((r) => setTimeout(r, 5));
/** n text files of about kb KiB each (compressible but not trivially). */
function texts(n, kb) {
  const dir = mkdtempSync(join(tmpdir(), 'compress-q-'));
  return Array.from({ length: n }, (_, i) => {
    let s = ''; while (s.length < kb * 1024) s += `function f${i}_${s.length}(a){return a+"${randomBytes(6).toString('hex')}"}\n`;
    const f = join(dir, `part-${i}.js`); writeFileSync(f, s); return f;
  });
}

test('queue: never more than `parallel` jobs; urgent before warm-up; promote moves a waiting job ahead', async () => {
  const q = createJobQueue(1), order = [];
  let peak = 0, now = 0;
  const job = (name, ms) => async () => { now++; peak = Math.max(peak, now); order.push(name); await new Promise((r) => setTimeout(r, ms)); now--; return name; };
  const all = [q.run(job('w1', 20)), q.run(job('w2', 5), false, 'b'), q.run(job('w3', 5), false, 'c'), q.run(job('r1', 5), true)];
  q.promote('c');
  assert.deepEqual(await Promise.all(all), ['w1', 'w2', 'w3', 'r1']);
  assert.equal(peak, 1);
  assert.deepEqual(order, ['w1', 'r1', 'w3', 'w2'], 'the running job finishes, then urgent, then promoted, then the rest');
  const q3 = createJobQueue(3); now = 0; peak = 0;
  await Promise.all(Array.from({ length: 9 }, (_, i) => q3.run(job('x' + i, 5))));
  assert.equal(peak, 3);
  assert.equal(createJobQueue('kaputt').stats().max, 1, 'a broken setting means one, never unlimited');
  // a failing job is reported and does not stop the queue
  await assert.rejects(q.run(async () => { throw new Error('zlib'); }), /zlib/);
  assert.equal(await q.run(async () => 'weiter'), 'weiter');
});

test('L4: while the warm-up compresses, a DNS lookup and a file read still get a thread at once', async () => {
  const q = createJobQueue(1), c = createCompressedFiles({ queue: q });
  const files = texts(24, 160);
  for (const f of files) c.warm(f);
  await tick();
  const jobs = q.stats().waiting + q.stats().running;
  assert.ok(jobs >= 40, `warm-up queued (${jobs})`);
  await lookup('localhost');                       // getaddrinfo runs in the same thread pool as zlib
  const left = q.stats().waiting;
  assert.ok(left >= jobs / 2, `the lookup did not wait for the warm-up (${left} of ${jobs} jobs still waiting)`);
  assert.ok(q.stats().running <= 1, 'never more than one zlib job in the pool');
});

test('L4: a request for a file still waiting in the warm-up is compressed before the rest of the warm-up', async () => {
  const q = createJobQueue(1), c = createCompressedFiles({ queue: q });
  const files = texts(20, 120), last = files[files.length - 1];
  for (const f of files) c.warm(f);
  await tick();
  let sent = null;
  const res = { writeHead(status, headers) { sent = { status, headers }; return this; }, end() {} };
  await c.serve({ method: 'GET', headers: { 'accept-encoding': 'br' } }, res, last, { 'Content-Type': 'text/javascript; charset=utf-8' });
  assert.equal(sent.status, 200); assert.equal(sent.headers['Content-Encoding'], 'br');
  assert.ok(q.stats().waiting >= 10, `served while most of the warm-up still waits (${q.stats().waiting})`);
});

test('L8: SIGTERM during the warm-up ends the process quickly (it waits for one running job, not for all)', async () => {
  const files = texts(40, 300);
  const code = `import { createCompressedFiles } from ${JSON.stringify(new URL('../lib/compress.mjs', import.meta.url).href)};
    const c = createCompressedFiles(); for (const f of ${JSON.stringify(files)}) c.warm(f);
    process.once('SIGTERM', () => process.exit(0)); console.log('warming'); setInterval(() => {}, 1000);`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, COMPRESS_PARALLEL: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok) => p.stdout.once('data', ok));
  await new Promise((r) => setTimeout(r, 300));
  const t0 = Date.now();
  p.kill('SIGTERM');
  const code2 = await new Promise((ok) => p.once('exit', (c) => ok(c)));
  const ms = Date.now() - t0;
  assert.equal(code2, 0);
  assert.ok(ms < 1000, `exit took ${ms} ms (without the limit: about 2-3 s here, about 10 s on the 2-CPU staging host)`);
});
