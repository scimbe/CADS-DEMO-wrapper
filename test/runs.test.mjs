import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allocatePorts, releasePorts } from '../lib/ports.mjs';
import { createRunDir, gcRuns, runDir, RUN_ID_RE, newRunId } from '../lib/runs.mjs';

test('concurrent port allocations never overlap', async () => {
  const sets = await Promise.all(Array.from({ length: 8 }, () => allocatePorts(2)));
  const all = sets.flat();
  assert.equal(new Set(all).size, all.length);
  sets.forEach(releasePorts);
});

test('two runs of the same demo get different directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'runs-'));
  const a = createRunDir(root, 'temporal-poc'), b = createRunDir(root, 'temporal-poc');
  assert.notEqual(a.dir, b.dir);
  assert.ok(RUN_ID_RE.test(a.runId) && existsSync(a.dir) && existsSync(b.dir));
});

test('runDir rejects path tricks', () => {
  const root = '/x';
  assert.throws(() => runDir(root, 'a', '../etc'));
  assert.throws(() => runDir(root, '../a', newRunId()));
});

test('gcRuns removes only stale runs', () => {
  const root = mkdtempSync(join(tmpdir(), 'runs-'));
  const old = createRunDir(root, 'x'), fresh = createRunDir(root, 'x');
  const past = new Date(Date.now() - 2 * 3600e3);
  utimesSync(old.dir, past, past);
  gcRuns(root);
  assert.ok(!existsSync(old.dir) && existsSync(fresh.dir));
});
