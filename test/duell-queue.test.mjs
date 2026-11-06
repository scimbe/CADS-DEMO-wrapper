// The waiting line in front of the model: priority with ageing, bounded length, timeout, parallel slots, visible position.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../lib/duell-queue.mjs';

const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
const tick = () => new Promise((r) => setImmediate(r));

test('priority: Business before Pro before Free, first come first served inside a tier', async () => {
  let t = 1000;
  const q = createQueue({ concurrency: 1, now: () => t }), g = gate(), ran = [];
  const job = (name) => async () => { ran.push(name); if (name === 'running') await g.p; return name; };
  const jobs = ['running', 'free1', 'pro1', 'free2', 'biz1', 'pro2'].map((n) => q.submit({ tier: n.replace(/\d$/, '').replace('running', 'free').replace('biz', 'business'), task: job(n) }));
  await tick();
  assert.deepEqual(jobs.map((j) => q.position(j.id)), [0, 4, 2, 5, 1, 3]);
  assert.deepEqual(q.stats().byTier, { business: 1, pro: 2, free: 2 });
  g.open();
  await Promise.all(jobs.map((j) => j.done));
  assert.deepEqual(ran, ['running', 'biz1', 'pro1', 'pro2', 'free1', 'free2']);
  assert.equal(q.position(jobs[0].id), -1, 'gone once done');
});

test('ageing: a Free job that waited long enough goes before a fresh Business job (nobody starves)', async () => {
  let t = 0;
  const q = createQueue({ concurrency: 1, agingMs: 10000, now: () => t }), g = gate(), ran = [];
  q.submit({ tier: 'free', task: async () => { await g.p; } });
  const free = q.submit({ tier: 'free', task: async () => ran.push('free') });
  t = 20001;   // waited more than 2 * agingMs
  const biz = q.submit({ tier: 'business', task: async () => ran.push('biz') });
  assert.equal(q.position(free.id), 1); assert.equal(q.position(biz.id), 2);
  g.open(); await Promise.all([free.done, biz.done]);
  assert.deepEqual(ran, ['free', 'biz']);
});

test('bounded: a full line refuses a newcomer of the same tier, but a higher tier pushes out the last Free job', async () => {
  const q = createQueue({ concurrency: 1, maxLen: 2 }), g = gate();
  q.submit({ tier: 'free', task: () => g.p });
  const a = q.submit({ tier: 'free', task: async () => 'a' }), b = q.submit({ tier: 'free', task: async () => 'b' });
  assert.deepEqual(q.submit({ tier: 'free', task: async () => 'c' }), { error: 'queue-full' });
  const biz = q.submit({ tier: 'business', task: async () => 'biz' });
  assert.ok(biz.id);
  assert.deepEqual(await b.done, { error: 'queue-full' }, 'the last Free job left');
  assert.equal(q.position(biz.id), 1); assert.equal(q.position(a.id), 2);
  g.open();
  assert.deepEqual(await biz.done, { value: 'biz' }); assert.deepEqual(await a.done, { value: 'a' });
});

test('timeout: a job that waited maxWaitMs leaves with queue-timeout and never runs', async () => {
  const q = createQueue({ concurrency: 1, maxWaitMs: 30 }), g = gate();
  let ran = false;
  q.submit({ tier: 'free', task: () => g.p });
  const late = q.submit({ tier: 'free', task: async () => { ran = true; } });
  assert.deepEqual(await late.done, { error: 'queue-timeout' });
  g.open(); await tick(); await tick();
  assert.equal(ran, false); assert.equal(q.stats().waiting, 0);
});

test('parallel slots: concurrency 2 runs two at once, never three; cancel takes a waiting job out', async () => {
  const q = createQueue({ concurrency: 2 }), g = gate();
  let now = 0, peak = 0;
  const task = async () => { now++; peak = Math.max(peak, now); await g.p; now--; };
  const jobs = [1, 2, 3, 4].map(() => q.submit({ tier: 'free', task }));
  await tick();
  assert.deepEqual(jobs.map((j) => q.position(j.id)), [0, 0, 1, 2]);
  assert.equal(q.cancel(jobs[3].id), true); assert.equal(q.cancel(jobs[0].id), false, 'a running job finishes');
  assert.deepEqual(await jobs[3].done, { error: 'cancelled' });
  g.open(); await Promise.all(jobs.slice(0, 3).map((j) => j.done));
  assert.equal(peak, 2);
  assert.ok(q.etaS(3) >= 1);
});

test('a failing task settles as task-failed and the line moves on', async () => {
  const q = createQueue({ concurrency: 1 });
  const bad = q.submit({ tier: 'free', task: async () => { throw new Error('boom'); } });
  const good = q.submit({ tier: 'free', task: async () => 7 });
  assert.equal((await bad.done).error, 'task-failed');
  assert.deepEqual(await good.done, { value: 7 });
});
