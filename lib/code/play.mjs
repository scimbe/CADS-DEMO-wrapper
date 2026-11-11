// My Daily Idea, Code-Modus: the automated playtest of a checked (instrumented) game module.
//
//   playtest(code, opts) -> { ok, errors, stats, texts, frames, meta }      runs INSIDE the worker (lib/code/play-worker.mjs)
//   playInWorker(code, opts) -> Promise of the same                         the server's entry: a worker thread with memory
//                                                                           limits, no env, killed after opts.wallMs
// Each runtime is its own vm context with code generation off (no eval, no Function, no wasm): the game sees the builtins
// of an empty realm, the SDK and nothing else. Data crosses only as JSON text, never as an object of this realm. vm is not
// the boundary on its own: the worker (resource limits, terminate) and the static check (lib/code/check.mjs) are the others.
//
// What a game must show before it is signed:
//   - no exception, no budget overrun, in every bot run (random and greedy, several seeds)
//   - every run ends within the step limit or keeps a small state; at least one run ends (over), the score moves, and what
//     the bots do matters (runs end differently; doing nothing differs from playing)
//   - state is plain JSON below 64 KiB; a snapshot restored into a NEW runtime continues to the same hash (resync works)
//   - the same seed and inputs give the same hash in a fresh runtime (determinism)
//   - view() is a valid display list for every seat, at most 600 ops
//   - two players (when the game allows them): two separate runtimes in lockstep over a fake channel with latency, jitter,
//     reordering and duplicates end with the same hash and no desync
// texts: every text the views showed (for the content check); frames: first and last view of seat 0 (for the snapshot).

import vm from 'node:vm';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { wrapForRun } from './check.mjs';

const require = createRequire(import.meta.url);
export const SDK = require('./sdk.js');

/** One sandboxed runtime of a game. Every call goes in and out as JSON text. */
export function runtime(code, { callMs = 1500 } = {}) {
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
  const run = (src, ms) => vm.runInContext(src, ctx, { timeout: ms, displayErrors: false });
  // the SDK as its own copy in the context (selfSource), then the module (top-level code) under a vm timeout; afterwards one
  // dispatcher, compiled once: strings in, a string out
  run(SDK.selfSource(), 2000);
  run(wrapForRun(code), 2000);
  const api = run(`(function (name, args) {
    var a = JSON.parse(args), r;
    if (name === "rawViewLength") { __guard.reset(); var v = __GAME.view(JSON.parse(__H.snapshot()).g, a[0]); r = Array.isArray(v) ? [v.length, v.filter(function (o) { return o && o.o === "text" && typeof o.s === "string" && Array.from(o.s).length > 40; }).map(function (o) { return o.s.slice(0, 50); })[0] || ""] : [-1, ""]; }
    else if (name === "peek") { var s = __H.snapshot(); try { r = __H.apply(a[0]).status.score[a[1]]; } finally { __H.restore(s); } }
    else if (name === "meta") r = __H.meta;
    else r = __H[name].apply(__H, a);
    return JSON.stringify(r === undefined ? null : r);
  })`, 2000);
  // a call has no vm timeout of its own (the op budget of the instrumented code bounds it, the worker's wall clock ends
  // anything else); one that took longer than callMs is reported as such
  const call = (name, ...args) => {
    const t = Date.now();
    let s;
    try { s = api(name, JSON.stringify(args)); }
    catch (e) {
      const fn = { apply: 'step', start: 'init', peek: 'step', rawViewLength: 'view' }[name] || name;
      throw new Error(`${fn}(): ${short(e)}`);
    }
    if (typeof s !== 'string') throw new Error('host answered no text');
    if (Date.now() - t > callMs) throw new Error(`${{ apply: 'step', start: 'init', peek: 'step' }[name] || name}() took ${Date.now() - t} ms, at most ${callMs}: far too much work per call`);
    return JSON.parse(s);
  };
  return {
    meta: call('meta'),
    start: (seed, params, players) => call('start', seed, params || {}, players),
    apply: (input, wantHash) => call('apply', input, !!wantHash),
    view: (seat) => call('view', seat),
    rawViewLength: (seat) => call('rawViewLength', seat),
    status: () => call('status'),
    moves: (seat) => call('moves', seat),
    hash: () => call('hash'),
    snapshot: () => call('snapshot'),
    restore: (s) => call('restore', s),
    /** score of seat after input, state unchanged (the greedy bot's look-ahead) */
    peek: (input, seat) => call('peek', input, seat),
  };
}

const short = (e) => String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 140);

/** The bot runs, determinism, snapshot and lockstep. opts: { runs, seeds, maxTurnSteps, maxTicks, params } */
export function playtest(code, opts = {}) {
  const errors = [], texts = new Set(), frames = [];
  const stats = { runs: 0, over: 0, steps: 0, maxState: 0, maxOps: 0, finals: [], scoreMoved: false, idleDiffers: null, lockstep: null, ms: 0 };
  const t0 = Date.now();
  const fail = (m) => { if (errors.length < 8 && !errors.includes(m)) errors.push(m); };
  let meta;
  try { meta = runtime(code).meta; } catch (e) { return { ok: false, errors: ['load: ' + short(e)], stats, texts: [], frames: [], meta: null }; }
  if (!meta) return { ok: false, errors: ['meta: GAME.meta is invalid (players {min,max} 1..4, mode turn|realtime, inputs)'], stats, texts: [], frames: [], meta: null };
  const runs = opts.runs || 6, maxTurn = opts.maxTurnSteps || 600, maxTicks = opts.maxTicks || 4000;
  const seats = meta.players.min;
  const look = (rt, n) => {
    for (let s = 0; s < n; s++) {
      const [len, long] = rt.rawViewLength(s);
      if (len < 0) throw new Error('view() must return an array');
      if (long) throw new Error(`view() shows a text longer than 40 characters, it would be cut: "${long}…" (split it into two lines)`);
      if (len > SDK.MAX_OPS) throw new Error(`view() returned ${len} ops, at most ${SDK.MAX_OPS}`);
      const v = rt.view(s);
      stats.maxOps = Math.max(stats.maxOps, v.length);
      for (const x of SDK.textsOfView(v)) texts.add(x);
    }
  };

  // one bot game in one runtime; returns the input log for the replay
  function botRun(seed, greedy, idle) {
    const rt = runtime(code), r = SDK.rngOf(SDK.seedState(seed ^ 0x5eed), seed), log = [];
    let st = rt.start(seed, opts.params || {}, seats).status;
    const first = st.score.slice();
    look(rt, seats);
    if (seed === 1) frames.push(rt.view(0));
    const realtime = meta.mode === 'realtime';
    const cap = realtime ? maxTicks : maxTurn;
    let n = 0;
    for (; n < cap && !st.over; n++) {
      const step = [];
      if (realtime) {
        for (let s = 0; s < seats; s++) if (!idle && r.chance(0.25)) { const mv = rt.moves(s); const i = SDK.botInput(meta, mv, s, r, greedy && mv && mv.length ? (x) => rt.peek(x, s) : null); if (i) step.push(i); }
        step.push({ seat: -1, t: 'tick' });
      } else if (!idle) {
        const s = st.turn === null ? 0 : st.turn, mv = rt.moves(s);
        const i = SDK.botInput(meta, mv, s, r, greedy && mv && mv.length ? (x) => rt.peek(x, s) : null);
        if (i) step.push(i); else break;
      } else break;
      for (const i of step) { log.push(i); st = rt.apply(i).status; }
      if (n % 25 === 0) { const size = rt.snapshot().length; stats.maxState = Math.max(stats.maxState, size); look(rt, seats); }
      if (st.score.some((x, k) => x !== first[k])) stats.scoreMoved = true;
    }
    stats.steps += n;
    look(rt, seats);
    return { rt, log, st, hash: rt.hash(), n };
  }

  try {
    const results = [];
    for (let k = 0; k < runs; k++) {
      const res = botRun(k + 1, k % 2 === 1, false);
      results.push(res);
      stats.runs++;
      if (res.st.over) stats.over++;
      stats.finals.push(res.st.score.join(':') + (res.st.over ? '' : '+'));
      if (k === 0) frames.push(res.rt.view(0));
    }
    if (!stats.over) fail(`no bot game ended within ${meta.mode === 'realtime' ? maxTicks + ' ticks' : maxTurn + ' moves'} (status().over never true: the game must be losable or end)`);
    if (!stats.scoreMoved) fail('the score never changed in any bot game (status().score)');
    if (new Set(stats.finals).size < 2) fail('every bot game ended exactly the same: the inputs seem to have no effect');
    const idle = botRun(1, false, true);
    stats.idleDiffers = idle.hash !== results[0].hash || meta.mode === 'turn';
    if (!stats.idleDiffers) fail('playing and doing nothing end in the same state: inputs have no effect');
    if (stats.maxState > SDK.MAX_STATE) fail('state too big');

    // determinism: the same seed and inputs in a fresh runtime
    const a = results[0], re = runtime(code);
    re.start(1, opts.params || {}, seats);
    for (const i of a.log) re.apply(i);
    if (re.hash() !== a.hash) fail('not deterministic: the same seed and inputs gave another state (use only rng, never Math.random or time)');

    // snapshot -> new runtime -> same continuation
    const b = runtime(code); b.start(1, opts.params || {}, seats);
    const half = Math.floor(a.log.length / 2);
    for (const i of a.log.slice(0, half)) b.apply(i);
    const c = runtime(code); c.start(1, opts.params || {}, seats); c.restore(b.snapshot());
    for (const i of a.log.slice(half)) { b.apply(i); c.apply(i); }
    if (b.hash() !== c.hash()) fail('state is not plain data: a restored snapshot continued differently');

    if (meta.players.max >= 2) stats.lockstep = lockstepSim(code, meta, opts, fail, texts);
  } catch (e) { fail('run: ' + short(e)); }
  stats.ms = Date.now() - t0;
  return { ok: errors.length === 0, errors, stats, texts: [...texts].slice(0, 200), frames, meta };
}

/** Two runtimes, two Lockstep instances, a channel with 20..220 ms latency, reordering and 5% duplicates, virtual time. */
export function lockstepSim(code, meta, opts, fail, texts, { seed = 7, maxMs = 240000 } = {}) {
  const net = SDK.rngOf(SDK.seedState(seed * 31 + 1), seed);
  const side = [0, 1].map((seat) => {
    const rt = runtime(code);
    rt.start(seed, opts.params || {}, 2);
    return { seat, rt, ls: SDK.Lockstep({ seat, seats: 2, mode: meta.mode, delay: 3, hashEvery: meta.mode === 'turn' ? 1 : 20 }), bot: SDK.rngOf(SDK.seedState(seed + seat * 99), seed), over: false, k: -1 };
  });
  const queue = [];   // { at, to, m }
  let now = 0, msgs = 0, dups = 0;
  const post = (from, m) => {
    const lat = 20 + net.int(200);
    queue.push({ at: now + lat, to: 1 - from, m: JSON.parse(JSON.stringify(m)) }); msgs++;
    if (net.chance(0.05)) { queue.push({ at: now + lat + net.int(300), to: 1 - from, m: JSON.parse(JSON.stringify(m)) }); dups++; }
  };
  let steps = 0;
  while (now < maxMs && !side.every((x) => x.over)) {
    for (const x of side) {
      if (x.over) continue;
      const st = x.rt.status();
      if (meta.mode === 'turn') {
        if (st.turn === x.seat && !x.waiting) {
          const mv = x.rt.moves(x.seat);
          const i = SDK.botInput(meta, mv, x.seat, x.bot, null);
          if (i) { x.ls.local(i); x.waiting = true; }
        }
      } else {
        if (x.bot.chance(0.25)) { const mv = x.rt.moves(x.seat); const i = SDK.botInput(meta, mv, x.seat, x.bot, null); if (i) x.ls.local(i); }
        x.ls.pump();
      }
      for (const step of x.ls.ready(() => x.rt.status().turn)) {
        for (const i of step.inputs) x.rt.apply(i);
        // the hash costs a canonical JSON of the state: only where Lockstep compares (every hashEvery steps)
        if (step.k % (meta.mode === 'turn' ? 1 : 20) === 0) x.ls.applied(step.k, x.rt.hash());
        x.k = step.k; x.waiting = false; steps++;
        if (x.rt.status().over) { x.over = true; break; }
      }
      for (const m of x.ls.out()) post(x.seat, m);
      if (x.ls.desync()) { fail(`two players drifted apart at step ${x.ls.desync().k} (lockstep desync)`); return { ok: false }; }
    }
    now += SDK.TICK_MS;
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0].at <= now) { const q = queue.shift(); side[q.to].ls.receive(q.m); }
    // the queue is shuffled within a tick window: delivery order inside one window is random (reordering)
    if (queue.length > 2 && net.chance(0.3)) { const i = net.int(queue.length - 1); const t = queue[i]; queue[i] = queue[i + 1]; queue[i + 1] = t; }
  }
  const [a, b] = side;
  for (const s of [0, 1]) for (const t of SDK.textsOfView(a.rt.view(s))) texts.add(t);
  const same = a.rt.hash() === b.rt.hash();
  if (!a.over || !b.over) fail(`a two-player game did not end within ${Math.round(maxMs / 1000)} s of play`);
  else if (!same) fail('two players ended with different states (lockstep)');
  return { ok: same && a.over && b.over, steps, msgs, dups, virtualMs: now, hashA: a.rt.hash(), hashB: b.rt.hash(), score: a.rt.status().score };
}

/** The server's entry: the playtest in a worker thread (memory limits, no env), terminated after wallMs. */
export function playInWorker(code, opts = {}, { wallMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./play-worker.mjs', import.meta.url), {
      workerData: { code, opts }, env: {}, argv: [], execArgv: [], stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4, codeRangeSizeMb: 32 },
    });
    let done = false;
    const end = (r) => { if (done) return; done = true; clearTimeout(t); w.terminate().catch(() => {}); resolve(r); };
    const t = setTimeout(() => end({ ok: false, errors: [`playtest took longer than ${wallMs} ms (too slow or endless)`], stats: {}, texts: [], frames: [], meta: null }), wallMs);
    w.once('message', (r) => end(r));
    w.once('error', (e) => end({ ok: false, errors: ['playtest crashed: ' + short(e)], stats: {}, texts: [], frames: [], meta: null }));
    w.once('exit', (c) => end({ ok: false, errors: ['playtest stopped (' + c + '): memory or crash'], stats: {}, texts: [], frames: [], meta: null }));
  });
}
