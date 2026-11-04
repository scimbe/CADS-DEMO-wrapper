// My Daily Idea: the waiting line in front of the one shared model (replaces the old "one call, everybody else 429").
//
//   * Priority Business > Pro > Free, with ageing: a job's rank is its arrival time plus TIER_RANK * agingMs. A Free job that
//     has waited 2 * agingMs ranks like a Business job that just arrived, so nobody waits for ever behind a busy team.
//   * Bounded: at most `maxLen` jobs wait. A full line refuses the newcomer, unless it outranks the last waiting job; then that
//     job leaves with 'queue-full'. "Last" is the lowest rank (tier plus ageing), so with no Free job waiting a Business
//     newcomer can push out a Pro job. A job that waited `maxWaitMs` leaves with 'queue-timeout'.
//   * At most `concurrency` jobs run at once (default 1). Each job's task runs exactly once; its result settles `done`.
//   * The position is visible: 1 = next, 0 = running, -1 = no longer known. Nothing here knows a person or a text.
//
// Everything is injectable (clock, timers) so the tests need no waiting.

export const TIER_RANK = { business: 0, pro: 1, free: 2 };
export const tierOf = (t) => (Object.prototype.hasOwnProperty.call(TIER_RANK, t) ? t : 'free');

export function createQueue({ concurrency = 1, maxLen = 30, maxWaitMs = 45000, agingMs = 10000, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const waiting = [];          // jobs sorted by rank, then by sequence
  const running = new Set();
  const jobs = new Map();      // id -> job (waiting or running)
  let seq = 0;
  const durations = [];        // last run times, for the estimate

  const rankOf = (j) => j.at + TIER_RANK[j.tier] * agingMs;
  const before = (a, b) => rankOf(a) - rankOf(b) || a.seq - b.seq;

  function settle(j, value) {
    if (j.settled) return;
    j.settled = true; if (j.timer) clearTimer(j.timer); jobs.delete(j.id);
    j.resolve(value);
  }
  function leave(j, error) {
    const i = waiting.indexOf(j);
    if (i >= 0) waiting.splice(i, 1);
    settle(j, { error });
  }
  function pump() {
    while (running.size < concurrency && waiting.length) {
      const j = waiting.shift();
      if (j.timer) clearTimer(j.timer);
      j.state = 'running'; j.startedAt = now(); running.add(j);
      if (j.onStart) try { j.onStart(); } catch { /* a listener never stops the line */ }
      Promise.resolve().then(j.task).then((value) => ({ value }), (e) => ({ error: 'task-failed', cause: e }))
        .then((r) => {
          running.delete(j);
          durations.push(now() - j.startedAt); if (durations.length > 20) durations.shift();
          settle(j, r); pump();
        });
    }
  }

  /** Puts a task in line. -> job { id, done: Promise<{value}|{error}> } or { error: 'queue-full' } at once. onStart runs when it starts. */
  function submit({ tier = 'free', task, onStart }) {
    const j = { id: ++seq, seq, tier: tierOf(tier), at: now(), task, onStart, state: 'waiting', settled: false };
    if (waiting.length >= maxLen) {
      const last = waiting[waiting.length - 1];
      if (!last || before(j, last) >= 0) return { error: 'queue-full' };
      leave(last, 'queue-full');
    }
    j.done = new Promise((r) => { j.resolve = r; });
    let i = waiting.length;
    while (i > 0 && before(j, waiting[i - 1]) < 0) i--;
    waiting.splice(i, 0, j); jobs.set(j.id, j);
    // not unref'd: a waiting job is work in progress (it is cleared the moment the job starts or leaves)
    if (maxWaitMs > 0) j.timer = setTimer(() => { if (j.state === 'waiting') leave(j, 'queue-timeout'); }, maxWaitMs);
    pump();
    return j;
  }
  /** 1-based place in line, 0 while running, -1 when the job is gone. */
  function position(id) {
    const j = jobs.get(id);
    if (!j) return -1;
    return j.state === 'running' ? 0 : waiting.indexOf(j) + 1;
  }
  /** Takes a waiting job out of line (a running one finishes). true when it was waiting. */
  function cancel(id) {
    const j = jobs.get(id);
    if (!j || j.state !== 'waiting') return false;
    leave(j, 'cancelled'); return true;
  }
  const avgMs = () => (durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 4000);
  /** Rough seconds until a job at `pos` starts: the jobs ahead, spread over the parallel slots. */
  const etaS = (pos) => Math.max(1, Math.ceil((Math.max(0, pos) * avgMs()) / concurrency / 1000));
  function stats() {
    const byTier = { business: 0, pro: 0, free: 0 };
    for (const j of waiting) byTier[j.tier]++;
    return { running: running.size, waiting: waiting.length, byTier, concurrency, maxLen, avgMs: Math.round(avgMs()) };
  }
  return { submit, position, cancel, stats, etaS, cfg: { concurrency, maxLen, maxWaitMs, agingMs } };
}
