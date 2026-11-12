// Worker of lib/duell-bau.mjs: runs the bot playtests of one game description off the main thread (the server stays responsive).
import { parentPort, workerData } from 'node:worker_threads';
import { pruefe } from './vendor/mdi-baukasten/engines/baukasten/pruefer.js';

let v;
try { v = pruefe(workerData.desc, { games: workerData.games, budget: workerData.budget, seed: workerData.seed }); }
catch (e) { v = { ok: false, stage: 'budget', errors: [String(e && e.message)], reasons: [{ code: 'budget', wert: 0, schwelle: 0, text: 'Pruefer-Fehler' }], metrics: null }; }
parentPort.postMessage({ ok: v.ok, stage: v.stage, errors: v.errors, reasons: v.reasons, metrics: v.metrics });
