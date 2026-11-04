#!/usr/bin/env node
// Quality gate of the five structured AI kinds (KI-Konzept 6.5): the golden set against the real model.
//
//   LITELLM_BASE_URL=https://llm.example LITELLM_KEY_FILE=~/.config/cads/litellm-test.key node bin/duell-golden.mjs [--kind plan,liste] [--redteam] [--out result.json]
//
// Every case runs the server's own path (read, need, screenInput, runKind with the kind's settings), then the case's checks
// decide whether the result fits the input ("passt inhaltlich"). Reports per kind: share that fits (goal >= 90 %), refusals,
// latency p50/max, output tokens and AI actions. --redteam runs the red-teaming cases (expected refusals) as well.
// Only test data is printed; the key is read from the file and never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { foldForFilter, makeLlm } from '../lib/duell.mjs';
import { KINDS, runKind, screenInput } from '../lib/duell-ai.mjs';
import { costOf } from '../lib/duell-pots.mjs';

export const GOLDEN = fileURLToPath(new URL('../test/fixtures/duell-golden.json', import.meta.url));
const fold = (v) => foldForFilter(typeof v === 'string' ? v : JSON.stringify(v));

/** Value at a dotted path; arrays on the way are mapped (posten.n -> all names). */
export function at(v, path) {
  if (!path) return v;
  let cur = v;
  for (const k of path.split('.')) cur = Array.isArray(cur) ? cur.flatMap((x) => { const y = x == null ? undefined : x[k]; return Array.isArray(y) ? y : [y]; }) : cur == null ? undefined : cur[k];
  return cur;
}
/** One check -> '' when it holds, else a short reason. */
export function check(root, c) {
  const v = at(root, c.at), arr = Array.isArray(v) ? v : [v], size = (x) => (Array.isArray(x) ? x.length : typeof x === 'string' ? [...x].length : Number(x));
  if ('eq' in c && JSON.stringify(v) !== JSON.stringify(c.eq)) return `${c.at}=${JSON.stringify(v)} != ${JSON.stringify(c.eq)}`;
  if (c.in && !c.in.includes(v)) return `${c.at}=${JSON.stringify(v)} not in list`;
  if (c.has && !c.has.every((x) => arr.includes(x))) return `${c.at} lacks ${JSON.stringify(c.has.filter((x) => !arr.includes(x)))}`;
  if (c.hasAny && !c.hasAny.some((x) => arr.includes(x))) return `${c.at} has none of ${JSON.stringify(c.hasAny)}`;
  if (c.not && c.not.some((x) => arr.includes(x))) return `${c.at} has ${JSON.stringify(c.not.filter((x) => arr.includes(x)))}`;
  if ('min' in c && !(size(v) >= c.min)) return `${c.at} ${size(v)} < ${c.min}`;
  if ('max' in c && !(size(v) <= c.max)) return `${c.at} ${size(v)} > ${c.max}`;
  if (c.any && !c.any.some((w) => fold(v).includes(fold(w)))) return `${c.at || 'result'} mentions none of ${JSON.stringify(c.any)}`;
  return '';
}
/** The checks of a case on a result: text kinds look at all variants, the others at the one option. */
export const verdict = (kind, options, expect) => expect.map((c) => check(kind === 'text' ? options : options[0], c)).filter(Boolean);

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const base = String(process.env.LITELLM_BASE_URL || '').replace(/\/+$/, '').replace(/\/v1$/, '');
  const keyFile = String(process.env.LITELLM_KEY_FILE || '').replace(/^~/, homedir());
  if (!base || !keyFile) { console.error('set LITELLM_BASE_URL and LITELLM_KEY_FILE'); process.exit(2); }
  const call = makeLlm({ baseUrl: base, apiKey: readFileSync(keyFile, 'utf8').trim(), model: process.env.LITELLM_DEFAULT_MODEL || 'local-qwen36-35b-a3b-coding', timeoutMs: 60000, temperature: 0.8, maxTokens: 900, detail: true });
  const set = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const only = arg('--kind', '') ? arg('--kind').split(',') : Object.keys(set.kinds);
  const runOne = async (kind, input) => {
    const def = KINDS[kind], d = def.read(input);
    if (!def.need(d)) return { outcome: 'bad-request', data: d };
    const bad = screenInput(def, d);
    if (bad) return { outcome: bad, data: d };
    const t = Date.now();
    try { const r = await runKind(def, d, 'de', call, []); return { ...r, outcome: r.fail || 'ok', ms: Date.now() - t, data: d }; }
    catch (e) { return { outcome: 'llm-error', ms: Date.now() - t, data: d }; }
  };
  const rows = [], detail = [];
  for (const kind of only) {
    const cases = set.kinds[kind], res = [];
    for (const c of cases) {
      const r = await runOne(kind, c.input), why = r.outcome === 'ok' ? verdict(kind, r.options, c.expect) : [r.outcome];
      res.push({ id: c.id, ok: !why.length, why, ms: r.ms || 0, tokens: r.tokens || 0, cost: r.outcome === 'ok' ? costOf(kind, r.tokens) : 0, outcome: r.outcome });
      console.error(`${c.id} ${why.length ? 'FAIL ' + why.join('; ') : 'ok'} ${r.ms || 0}ms ${r.tokens || 0}tok`);
    }
    const ms = res.filter((x) => x.ms).map((x) => x.ms).sort((a, b) => a - b), ok = res.filter((x) => x.ok).length;
    rows.push({ kind, n: res.length, ok, rate: +(100 * ok / res.length).toFixed(1), refused: res.filter((x) => x.outcome !== 'ok').length, p50ms: ms[Math.floor(ms.length / 2)] || 0, maxMs: ms.at(-1) || 0, tokAvg: Math.round(res.reduce((a, x) => a + x.tokens, 0) / res.length), costAvg: +(res.reduce((a, x) => a + x.cost, 0) / res.length).toFixed(2) });
    detail.push({ kind, cases: res });
  }
  let red = null;
  if (process.argv.includes('--redteam')) {
    red = [];
    for (const c of set.redteam) {
      const r = await runOne(c.kind, c.input);
      const absent = (c.absent || []).filter((x) => JSON.stringify(r.data).includes(x));
      const pass = c.want === 'redacted' ? !absent.length : c.want === 'unkind' ? ['unkind', 'blocked'].includes(r.outcome) : r.outcome === c.want;
      red.push({ id: c.id, class: c.class, want: c.want, got: r.outcome, pass, ...(absent.length ? { leaked: absent.length } : {}) });
      console.error(`${c.id} ${c.class}: want ${c.want}, got ${r.outcome} ${pass ? 'PASS' : 'FAIL'}`);
    }
  }
  console.log('| kind | Faelle | passt inhaltlich | Anteil | abgewiesen/kaputt | p50 ms | max ms | Ausgabe-Token avg | KI-Aktionen avg |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.kind} | ${r.n} | ${r.ok} | ${r.rate} % | ${r.refused} | ${r.p50ms} | ${r.maxMs} | ${r.tokAvg} | ${r.costAvg} |`);
  if (red) { console.log(`\nRed-Teaming: ${red.filter((x) => x.pass).length}/${red.length} wie erwartet`); for (const x of red) console.log(`- ${x.id} ${x.class}: erwartet ${x.want}, erhalten ${x.got} -> ${x.pass ? 'ok' : 'NICHT ok'}`); }
  if (arg('--out', '')) writeFileSync(arg('--out'), JSON.stringify({ at: new Date().toISOString(), rows, detail, red }, null, 1));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
