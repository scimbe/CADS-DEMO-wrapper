// Per-run work directories: every visitor run unpacks into its own directory, so concurrent runs
// can never clobber each other (the old shared work/<slug> was wiped on every run).
import { mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const RUN_ID_RE = /^r[0-9a-f]{10}$/;
export const newRunId = () => 'r' + randomBytes(5).toString('hex');

export function runDir(runsRoot, slug, runId) {
  if (!RUN_ID_RE.test(runId) || !/^[a-z0-9_-]+$/.test(slug)) throw new Error('bad run id');
  return join(runsRoot, `${slug}-${runId}`);
}

export function createRunDir(runsRoot, slug, runId = newRunId()) {
  const dir = runDir(runsRoot, slug, runId);
  mkdirSync(dir, { recursive: true });
  return { runId, dir };
}

/** Remove run directories not touched for maxAgeMs (default 1 h). Returns the removed names. */
export function gcRuns(runsRoot, maxAgeMs = 3600e3, now = Date.now()) {
  const gone = [];
  let names = [];
  try { names = readdirSync(runsRoot); } catch { return gone; }
  for (const n of names) {
    try {
      const p = join(runsRoot, n);
      if (now - statSync(p).mtimeMs > maxAgeMs) { rmSync(p, { recursive: true, force: true }); gone.push(n); }
    } catch { /* raced with another gc */ }
  }
  return gone;
}
