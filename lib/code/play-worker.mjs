// The worker of lib/code/play.mjs: runs one playtest and posts the result (plain JSON). No env, memory limits, terminated by
// the parent after its wall clock.
import { parentPort, workerData } from 'node:worker_threads';
import { playtest } from './play.mjs';

let r;
try { r = playtest(workerData.code, workerData.opts || {}); }
catch (e) { r = { ok: false, errors: ['playtest: ' + String((e && e.message) || e).slice(0, 140)], stats: {}, texts: [], frames: [], meta: null }; }
parentPort.postMessage(JSON.parse(JSON.stringify(r)));
