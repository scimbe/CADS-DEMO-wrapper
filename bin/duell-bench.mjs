#!/usr/bin/env node
// Throughput of the model behind My Daily Idea at 1..n parallel calls, to choose DUELL_LLM_PARALLEL.
//
//   LITELLM_BASE_URL=https://llm.example LITELLM_KEY_FILE=~/.config/cads/litellm-test.key node bin/duell-bench.mjs [--par 1,2,3,4] [--n 8]
//
// Each level sends n real requests of the game config (the shortest kind) and of a card wish (the typical kind), `par` at a
// time, with the production settings (thinking off, the same system prompts). Reports per level: wall time, latency p50/max,
// completion tokens and tokens/s per stream and in total. The key is read from the file and never printed.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { makeLlm, systemPrompt, llmText } from '../lib/duell.mjs';
import { KINDS } from '../lib/duell-ai.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levels = String(arg('--par', '1,2,3,4')).split(',').map(Number).filter((n) => n >= 1);
const n = Number(arg('--n', 8));
const base = String(process.env.LITELLM_BASE_URL || '').replace(/\/+$/, '').replace(/\/v1$/, '');
const keyFile = String(process.env.LITELLM_KEY_FILE || '').replace(/^~/, homedir());
const model = process.env.LITELLM_DEFAULT_MODEL || 'local-qwen36-35b-a3b-coding';
if (!base || !keyFile) { console.error('set LITELLM_BASE_URL and LITELLM_KEY_FILE'); process.exit(2); }
const apiKey = readFileSync(keyFile, 'utf8').trim();

const WISHES = ['Weltraum mit Rakete', 'entspannt unter Wasser', 'schwer und schnell in der Wüste', 'Pixel Retro Frosch', 'Süßigkeiten Welt', 'Nachtflug über die Stadt', 'Dino im Dschungel', 'Schneesturm am Nordpol'];
const tasks = {
  config: (i) => [systemPrompt('de'), `<wish>${WISHES[i % WISHES.length]} ${i}</wish>`, makeLlm({ baseUrl: base, apiKey, model, timeoutMs: 60000, detail: true })],
  wish: (i) => { const d = KINDS.wish.read({ type: 'card', wish: WISHES[i % WISHES.length] + ' ' + i, idea: 'Karte für einen Freund', now: { x: 'Hallo' } }); return [KINDS.wish.system('de', d), KINDS.wish.user(d), makeLlm({ baseUrl: base, apiKey, model, timeoutMs: 60000, temperature: 0.8, maxTokens: 600, detail: true })]; },
};
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const rows = [];
for (const kind of Object.keys(tasks)) {
  for (const par of levels) {
    const lat = [], toks = []; let next = 0, fail = 0;
    const t0 = Date.now();
    await Promise.all(Array.from({ length: par }, async () => {
      while (next < n) {
        const i = next++, [sys, user, call] = tasks[kind](i + par * 100), s = Date.now();
        try { const { tokens } = llmText(await call(sys, user)); lat.push(Date.now() - s); toks.push(tokens); } catch { fail++; }
      }
    }));
    const wall = (Date.now() - t0) / 1000, sum = toks.reduce((a, b) => a + b, 0), ms = lat.reduce((a, b) => a + b, 0);
    rows.push({ kind, par, n, ok: lat.length, fail, wallS: +wall.toFixed(1), p50ms: pct(lat, 0.5), maxMs: Math.max(...lat), tokAvg: Math.round(sum / (toks.length || 1)), tokPerSStream: +(sum / (ms / 1000 || 1)).toFixed(1), tokPerSTotal: +(sum / wall).toFixed(1), reqPerMin: +((lat.length / wall) * 60).toFixed(1) });
    console.error(JSON.stringify(rows.at(-1)));
  }
}
console.log('| kind | parallel | ok/n | wall s | p50 ms | max ms | out tokens avg | tok/s per stream | tok/s total | req/min |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.kind} | ${r.par} | ${r.ok}/${r.n} | ${r.wallS} | ${r.p50ms} | ${r.maxMs} | ${r.tokAvg} | ${r.tokPerSStream} | ${r.tokPerSTotal} | ${r.reqPerMin} |`);
