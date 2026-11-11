#!/usr/bin/env node
// Harness swarm for the free card ("Erschaffe deine Karte"): a population of persona agents (Claude Haiku 5.5, no knowledge
// of the app beyond its screen) types wishes; a judge checks they read like real people; every wish goes through the real
// free-card pipeline (lib/duell-karte.mjs via lib/duell-ai.mjs, Haiku 5.5 as in production); a stronger judge (Claude
// Sonnet 5.5, calibrated against Claude Opus 5.5) grades intent, Vorstellung, routing/honesty and quality; a sample is
// corrected by its persona up to three times. Harness configs (candidates) are compared by persona split.
//
// This is an LLM-judged evaluation. It does NOT replace the human gold corpus (bin/duell-karte-golden.mjs --v21, frozen by
// a person); nothing here is a "bestanden" against gold labels.
//
//   node eval/swarm.mjs <stage> [--run DIR] [--cap 43] [--key-file ~/DocFlow/.env] [options]
//   stages: population | prompts [--limit N] [--personas p01,p02] | realism | sut --config NAME [--split train|val|test|all] [--ids a,b]
//           | judge --config NAME [--judge-model M] [--split ...] | calib | correct --config NAME [--share 0.25] | candidate --name N --patch FILE
//           | compare --a NAME --b NAME --split val | cost
// The key is read from the env file at runtime (variable ANTHROPIC_API_KEY) and never printed. Every call books into
// <run>/ledger.json; at --cap USD (default 43) every further call is refused and the stage ends cleanly.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendJsonl, client, createLedger, keyFrom, limiter, retryingFetch } from './lib/api.mjs';
import { makePopulation, makeTasks, splitPersonas, TOPICS, rng } from './lib/population.mjs';
import { featuresOf, distribution, rewardOf, passOf, meanCi, pairedDelta, weightedKappa, groupBy } from './lib/stats.mjs';
import { describe, applyWish } from './lib/render.mjs';
import { loadSut, wishTypeOf } from './lib/sut.mjs';
import { CORR_JUDGE_SCHEMA, CORR_JUDGE_SYSTEM, CORR_SCHEMA, JUDGE_SCHEMA, PERSONA_SCHEMA, PERSONA_SYSTEM, REALISM_SCHEMA, REALISM_SYSTEM, SOON_NEAR, artOf, corrUser, judgeSystem, judgeUser, personaUser } from './lib/prompts.mjs';
import { mcnemarPaired, cohenKappa } from '../lib/harness-stats.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), stage = args[0];
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const RUN = resolve(arg('run', join(ROOT, 'eval/runs/main')));
const CAP = Number(arg('cap', '43'));
const P = (f) => join(RUN, f);
const readJ = (f, d) => (existsSync(P(f)) ? JSON.parse(readFileSync(P(f), 'utf8')) : d);
const writeJ = (f, o) => { mkdirSync(dirname(P(f)), { recursive: true }); writeFileSync(P(f), JSON.stringify(o, null, 1)); };
const readL = (f) => (existsSync(P(f)) ? readFileSync(P(f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const log = (o) => process.stderr.write(JSON.stringify(o) + '\n');
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const JUDGE = arg('judge-model', 'claude-sonnet-5-5');

mkdirSync(RUN, { recursive: true });
const ledger = createLedger(P('ledger.json'), CAP);
let key = '';
const needKey = () => { if (!key) key = keyFrom(resolve(String(arg('key-file', '~/DocFlow/.env')).replace(/^~(?=\/)/, homedir()))); return key; };
let callApi;
const api = () => (callApi = callApi || client({ key: needKey(), ledger, fetchImpl: retryingFetch(fetch, { log }) }));
const conc = Number(arg('conc', '8'));
const capHit = (e) => e && e.code === 'cap';

const pop = () => readJ('personas.json', null) || (() => { throw new Error('run "population" first'); })();
const personaById = () => Object.fromEntries(pop().map((p) => [p.id, p]));
const personaLine = (p) => `${p.age} J., ${p.life}, ${p.lang === 'en' ? 'English-speaking (' + p.mig + ')' : 'Hintergrund: ' + p.mig + '; ' + p.region}, Handy: ${p.digital}`;
const splitOf = () => readJ('split.json', null);
function idsOf(rows, split) {
  if (!split || split === 'all') return rows;
  const s = splitOf(), set = new Set(split.split(',').flatMap((x) => s[x] || []));
  return rows.filter((r) => set.has(r.persona));
}
/** the prompts that enter the SUT: the last accepted version of each task (realism >= 3) */
function finalPrompts() {
  const all = readL('prompts.jsonl'), real = readJ('realism.json', {});
  const last = {};
  for (const r of all) last[r.id] = r;          // a re-sample replaces the first version
  return Object.values(last).filter((r) => !r.error && (!real[r.id] || real[r.id].v === r.v ? (real[r.id] ? real[r.id].human >= 3 : true) : true)).filter((r) => real[r.id] && real[r.id].v === r.v && real[r.id].human >= 3);
}

async function stagePopulation() {
  const people = makePopulation(Number(arg('seed', '20261111')));
  writeJ('personas.json', people);
  writeJ('tasks.json', makeTasks(people, 7, Number(arg('per', '16'))));
  writeJ('split.json', splitPersonas(people, 3));
  console.log(JSON.stringify({ personas: people.length, en: people.filter((p) => p.lang === 'en').length, tasks: readJ('tasks.json').length, split: Object.fromEntries(Object.entries(readJ('split.json')).map(([k, v]) => [k, v.length])) }));
}

async function personaCall(p, task, extra = '') {
  const topic = TOPICS.find((t) => t.id === task.topic);
  const r = await api()({ role: 'persona', model: 'claude-haiku-5-5', system: PERSONA_SYSTEM, user: personaUser(p, task, topic, extra), schema: PERSONA_SCHEMA, maxTokens: 1500, effort: 'medium' });
  if (!r.json) return { error: 'persona-' + (r.stop || 'json') };
  const j = r.json, getippt = String(j.getippt || '').replace(/^["„“]|["“”]$/g, '').trim();
  return { situation: j.situation, kategorie: j.kategorie, spielart: j.spielart, getippt, vorstellung: j.vorstellung };
}

async function stagePrompts() {
  const P0 = personaById(), tasks = readJ('tasks.json'), done = new Set(readL('prompts.jsonl').map((r) => r.id));
  const only = arg('personas', '') ? new Set(arg('personas').split(',')) : null;
  let todo = tasks.filter((t) => !done.has(t.id) && (!only || only.has(t.persona)));
  const lim = Number(arg('limit', '0')); if (lim) todo = todo.slice(0, lim);
  const L = limiter(conc); let n = 0, stop = false;
  await Promise.all(todo.map((t) => L(async () => {
    if (stop) return;
    try { const r = await personaCall(P0[t.persona], t); appendJsonl(P('prompts.jsonl'), { id: t.id, persona: t.persona, topic: t.topic, lang: P0[t.persona].lang, v: 1, ...r }); if (++n % 50 === 0) log({ prompts: n, usd: ledger.get().usd.toFixed(3) }); }
    catch (e) { if (capHit(e)) { stop = true; log({ cap: true }); } else log({ id: t.id, err: e.message }); }
  })));
  console.log(JSON.stringify({ written: n, usd: ledger.get().usd }));
}

async function judgeRealism(rows) {
  const out = {}; const L = limiter(Math.max(2, Math.floor(conc / 2)));
  const batches = []; for (let i = 0; i < rows.length; i += 12) batches.push(rows.slice(i, i + 12));
  await Promise.all(batches.map((b) => L(async () => {
    const user = 'Items:\n' + b.map((r) => `${r.id} [${r.lang}]: ${JSON.stringify(r.getippt)}`).join('\n');
    try {
      const r = await api()({ role: 'realism', model: JUDGE, system: REALISM_SYSTEM, user, schema: REALISM_SCHEMA, maxTokens: 3000, effort: 'low' });
      for (const it of (r.json && r.json.items) || []) { const row = b.find((x) => x.id === it.id); if (row) out[it.id] = { ...it, v: row.v }; }
    } catch (e) { if (capHit(e)) throw e; log({ realism: e.message }); }
  })));
  return out;
}
async function stageRealism() {
  const P0 = personaById(), tasks = Object.fromEntries(readJ('tasks.json').map((t) => [t.id, t]));
  const last = {}; for (const r of readL('prompts.jsonl')) last[r.id] = r;
  const real = readJ('realism.json', {});
  let rows = Object.values(last).filter((r) => !r.error && (!real[r.id] || real[r.id].v !== r.v));
  Object.assign(real, await judgeRealism(rows)); writeJ('realism.json', real);
  // re-sample once where the judge found the text AI-like (human < 3): the same persona and situation, told to type as they really would
  const low = Object.values(last).filter((r) => real[r.id] && real[r.id].v === r.v && real[r.id].human < 3 && r.v === 1);
  log({ realism: Object.keys(real).length, low: low.length });
  const L = limiter(conc), again = [];
  await Promise.all(low.map((r) => L(async () => {
    const extra = `\nA first attempt by this person read too polished, like an AI wrote it: ${JSON.stringify(r.getippt)}. Type it again the way this person really types on a phone: shorter, own words, their own mistakes and habits.`;
    try { const n = await personaCall(P0[r.persona], tasks[r.id], extra); if (!n.error) { const row = { id: r.id, persona: r.persona, topic: r.topic, lang: r.lang, v: 2, ...n }; appendJsonl(P('prompts.jsonl'), row); again.push(row); } }
    catch (e) { if (capHit(e)) throw e; }
  })));
  Object.assign(real, await judgeRealism(again)); writeJ('realism.json', real);
  realismReport();
}
function realismReport() {
  const real = readJ('realism.json', {}), last = {}; for (const r of readL('prompts.jsonl')) last[r.id] = r;
  const names = new Set();
  try { const ai = readFileSync(join(ROOT, 'lib/duell-ai.mjs'), 'utf8'); const m = /FIRST_NAMES = new Set\(\('([^']+)'\s*\+\s*'([^']*)'/.exec(ai); if (m) (m[1] + m[2]).split(/\s+/).forEach((n) => n && names.add(n)); } catch { /* none */ }
  const rows = Object.values(last).filter((r) => !r.error && real[r.id] && real[r.id].v === r.v);
  const acc = rows.filter((r) => real[r.id].human >= 3);
  const feats = acc.map((r) => featuresOf(r.getippt, names));
  const flags = (rs) => Object.fromEntries(['typos', 'dialect', 'too_polished', 'list', 'over_polite', 'llm_phrasing'].map((k) => [k, rs.length ? rs.filter((r) => real[r.id][k]).length / rs.length : 0]));
  const hum = (rs) => meanCi(rs.map((r) => real[r.id].human));
  const firstRound = readL('prompts.jsonl').filter((r) => r.v === 1 && !r.error);
  const P0 = personaById();
  const cov = {};
  for (const r of acc) { const p = P0[r.persona], k = `${p.band}|${p.lang}`; cov[k] = cov[k] || {}; cov[k][r.topic] = (cov[k][r.topic] || 0) + 1; }
  const catByTopic = {}; for (const r of acc) { catByTopic[r.topic] = catByTopic[r.topic] || {}; const c = r.kategorie + (r.spielart && r.spielart !== '-' ? '/' + r.spielart : ''); catByTopic[r.topic][c] = (catByTopic[r.topic][c] || 0) + 1; }
  const rep = {
    generated_v1: firstRound.length, resampled: readL('prompts.jsonl').filter((r) => r.v === 2).length, judged_final: rows.length, accepted: acc.length, rejected_final: rows.length - acc.length,
    human_score_all_final: hum(rows), human_score_accepted: hum(acc), flags_accepted: flags(acc), surface: distribution(feats),
    by_lang: Object.fromEntries(Object.entries(groupBy(acc, (r) => r.lang)).map(([k, v]) => [k, { n: v.length, human: hum(v).mean, words_p50: distribution(v.map((r) => featuresOf(r.getippt, names))).words.p50 }])),
    by_band: Object.fromEntries(Object.entries(groupBy(acc, (r) => P0[r.persona].band)).map(([k, v]) => [k, { n: v.length, human: +hum(v).mean.toFixed(2), allLower: +distribution(v.map((r) => featuresOf(r.getippt, names))).shares.allLower.toFixed(2) }])),
    coverage_band_lang_x_topic: cov, category_by_topic: catByTopic,
  };
  writeJ('realism-report.json', rep);
  console.log(JSON.stringify({ accepted: rep.accepted, rejected: rep.rejected_final, human: rep.human_score_accepted, words: rep.surface.words }));
}

// ---- candidates (harness configs) ---------------------------------------------------------------------------------------
function libOf(name) {
  const dir = P(`cand/${name}/lib`);
  if (!existsSync(dir)) throw new Error('unknown config ' + name + ' (stage candidate)');
  return dir;
}
function stageCandidate() {
  const name = arg('name'), patch = arg('patch', ''), from = arg('from', '');
  const dir = P(`cand/${name}`);
  if (existsSync(dir)) throw new Error('candidate exists: ' + name);
  mkdirSync(dir, { recursive: true });
  cpSync(from ? libOf(from) : join(ROOT, 'lib'), join(dir, 'lib'), { recursive: true });
  if (patch) execFileSync('patch', ['-p1', '-d', dir, '-i', resolve(patch)], { stdio: 'inherit' });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ name, from: from || 'worktree', patch: patch ? readFileSync(resolve(patch), 'utf8') : '' }, null, 1));
  console.log('candidate', name);
}

// ---- system under test ---------------------------------------------------------------------------------------------------
const sutCache = {};
async function sutOf(name) { return (sutCache[name] = sutCache[name] || await loadSut(libOf(name), { key: needKey(), ledger, fetchImpl: retryingFetch(fetch, { log }), call: api() })); }
async function runOne(sut, r, P0) {
  const p = P0[r.persona], ui = artOf(r.lang, r.kategorie, r.spielart);
  if (ui.soon) return { bald: r.spielart, catalog: SOON_NEAR[ui.soon], calls: 0, usd: 0 };
  if (!ui.art) return { fail: 'need', why: 'art', calls: 0, usd: 0 };
  return sut.runCase({ text: r.typedNow || r.getippt, art: ui.art, genre: ui.genre, age: p.age >= 18 ? 'a18' : 'u18', lang: r.lang });
}
async function stageSut() {
  const name = arg('config'), sut = await sutOf(name), P0 = personaById();
  const file = `sut-${name}.jsonl`, done = new Set(readL(file).map((r) => r.id));
  let rows = idsOf(finalPrompts(), arg('split', 'all')).filter((r) => !done.has(r.id));
  if (arg('ids')) { const s = new Set(arg('ids').split(',')); rows = rows.filter((r) => s.has(r.id)); }
  if (arg('limit')) rows = rows.slice(0, Number(arg('limit')));
  // --affected FILE --reuse NAME: a candidate that changes only the deterministic routing (word lists, matching) re-runs
  // only the prompts whose route it changes (FILE exports affected(text, ui, age, baseLib, candLib) -> bool); every other
  // prompt keeps the result of config NAME, since the same code runs for it (marked reused)
  let affected = null, reuse = {};
  if (arg('affected')) {
    const m = await import(resolve(arg('affected')));
    const [bl, cl, ba, ca] = await Promise.all([import(join(libOf(arg('reuse', 'base')), 'duell-karte.mjs')), import(join(libOf(name), 'duell-karte.mjs')),
      import(join(libOf(arg('reuse', 'base')), 'duell-ai.mjs')), import(join(libOf(name), 'duell-ai.mjs'))]);
    affected = (r) => { const ui = artOf(r.lang, r.kategorie, r.spielart); return m.affected(r.getippt, ui, P0[r.persona].age >= 18 ? 'a18' : 'u18', bl, cl, { baseAi: ba, candAi: ca }); };
    reuse = Object.fromEntries(readL(`sut-${arg('reuse', 'base')}.jsonl`).map((x) => [x.id, x]));
  }
  const L = limiter(conc); let n = 0, kept = 0, stop = false;
  await Promise.all(rows.map((r) => L(async () => {
    if (stop) return;
    if (affected && reuse[r.id] && !affected(r)) { appendJsonl(P(file), { ...reuse[r.id], reusedFrom: arg('reuse', 'base') }); kept++; return; }
    try {
      const out = await runOne(sut, r, P0), shown = describe(out, sut.byId, r.lang);
      appendJsonl(P(file), { id: r.id, persona: r.persona, out: { ...out, options: out.options && out.options.map((o) => ({ art: o.art, doc: o.doc })) }, shown, at: Date.now() });
      if (++n % 50 === 0) log({ sut: name, n, usd: ledger.get().usd.toFixed(3) });
    } catch (e) { if (capHit(e)) { stop = true; log({ cap: true }); } else log({ id: r.id, err: e.message }); }
  })));
  console.log(JSON.stringify({ config: name, ran: n, reused: kept, usd: ledger.get().usd }));
}

// ---- judge ---------------------------------------------------------------------------------------------------------------
let jsys;
async function judgeSys() { if (!jsys) { const k = await import(join(ROOT, 'lib/duell-karte.mjs')); jsys = judgeSystem(k.CAPS); } return jsys; }
async function gradeOne(row, shownText, model = JUDGE, tag = '') {
  const r = await api()({ role: 'judge' + (tag ? '-' + tag : ''), model, system: await judgeSys(), user: judgeUser(row, shownText), schema: JUDGE_SCHEMA, maxTokens: 2000, effort: 'low' });
  return r.json ? { ...r.json, model } : { error: 'judge-' + r.stop };
}
async function stageJudge() {
  const name = arg('config'), file = `grades-${name}.jsonl`;
  const prompts = Object.fromEntries(finalPrompts().map((r) => [r.id, r])), P0 = personaById();
  // identical shown text for the same prompt gets the cached grade of any config (a refusal from the table is the same text)
  const cache = {}; for (const f of [arg('reuse', 'base'), 'base', name, ...String(arg('reuse', '')).split(',').filter(Boolean)]) for (const g of readL(`grades-${f}.jsonl`)) if (!g.error) cache[g.key] = g;
  const done = new Set(readL(file).map((g) => g.id));
  const rows = idsOf(readL(`sut-${name}.jsonl`).map((s) => ({ ...s, persona: s.persona })), arg('split', 'all')).filter((s) => !done.has(s.id) && prompts[s.id]);
  const L = limiter(conc); let n = 0, reused = 0, stop = false;
  await Promise.all(rows.map((s) => L(async () => {
    if (stop) return;
    const pr = prompts[s.id], k = hash(JUDGE + '|' + s.id + '|' + s.shown.text);
    if (cache[k]) { appendJsonl(P(file), { ...cache[k], id: s.id, reused: true }); reused++; return; }
    try {
      const g = await gradeOne({ ...pr, personaLine: personaLine(P0[pr.persona]) }, s.shown.text);
      appendJsonl(P(file), { id: s.id, key: k, ...g }); n++;
      if (n % 50 === 0) log({ judge: name, n, usd: ledger.get().usd.toFixed(3) });
    } catch (e) { if (capHit(e)) { stop = true; log({ cap: true }); } else log({ id: s.id, err: e.message }); }
  })));
  console.log(JSON.stringify({ config: name, graded: n, reused, usd: ledger.get().usd }));
}
const gradesOf = (name) => { const g = {}; for (const x of readL(`grades-${name}.jsonl`)) if (!x.error) g[x.id] = x; return g; };

// ---- calibration ---------------------------------------------------------------------------------------------------------
async function stageCalib() {
  const g = gradesOf('base'), sut = Object.fromEntries(readL('sut-base.jsonl').map((s) => [s.id, s]));
  const prompts = Object.fromEntries(finalPrompts().map((r) => [r.id, r])), P0 = personaById();
  // 40 items stratified by failure tag and outcome kind (not only the easy ones)
  const r = rng(99), ids = Object.keys(g).filter((id) => sut[id] && prompts[id]);
  const by = groupBy(ids, (id) => (g[id].failure || 'none') + '|' + sut[id].shown.kind);
  const pickIds = []; const keys = Object.keys(by).sort();
  const N = Number(arg('n', '40'));
  for (let round = 0; pickIds.length < N && round < N; round++) for (const k of keys) { const a = by[k]; if (a.length > round && pickIds.length < N) pickIds.push(a[Math.floor(r() * a.length)]); }
  const uniq = [...new Set(pickIds)].slice(0, N);
  const out = readJ('calib.json', {});
  const L = limiter(4);
  await Promise.all(uniq.filter((id) => !out[id]).map((id) => L(async () => {
    const row = { ...prompts[id], personaLine: personaLine(P0[prompts[id].persona]) };
    const [again, opus] = await Promise.all([gradeOne(row, sut[id].shown.text, JUDGE, 'calib'), gradeOne(row, sut[id].shown.text, 'claude-opus-5-5', 'calib')]);
    out[id] = { first: g[id], again, opus }; writeJ('calib.json', out);
  })));
  const dims = ['intent', 'vorstellung', 'routing', 'quality'], res = {};
  for (const [lab, other] of [['sonnet_vs_sonnet', 'again'], ['sonnet_vs_opus', 'opus']]) {
    const items = Object.values(out).filter((x) => x[other] && !x[other].error);
    res[lab] = { n: items.length };
    for (const d of dims) {
      const pairs = items.map((x) => [x.first[d], x[other][d]]);
      res[lab][d] = { exact: pairs.filter(([a, b]) => a === b).length / pairs.length, within1: pairs.filter(([a, b]) => Math.abs(a - b) <= 1).length / pairs.length, kappa_w: +weightedKappa(pairs).toFixed(3), mean_first: pairs.reduce((s, [a]) => s + a, 0) / pairs.length, mean_other: pairs.reduce((s, [, b]) => s + b, 0) / pairs.length };
    }
    res[lab].pass = cohenKappa(items.map((x) => [passOf(x.first), passOf(x[other])]));
    res[lab].failure_tag_agree = items.filter((x) => x.first.failure === x[other].failure).length / items.length;
    res[lab].low_agreement = dims.filter((d) => res[lab][d].kappa_w < 0.6);
  }
  writeJ('calib-report.json', res);
  console.log(JSON.stringify(res, null, 1));
}

// ---- correction ----------------------------------------------------------------------------------------------------------
const WAYS = (kind, wishable) => kind === 'card'
  ? (wishable ? '"Übernehmen" opens the editor where you can type a wish to the AI for this card ("wunsch") or change texts, stickers and style by hand ("selbst"); or "Verwerfen" and type a new sentence ("neu").' : '"Übernehmen" opens the editor where you can change texts by hand ("selbst"); or "Verwerfen" and type a new sentence ("neu").')
  : 'There is no card, only this message. You can type a new sentence, maybe with another category ("neu"), or give up ("fertig").';
async function stageCorrect() {
  const name = arg('config', 'base'), sut = await sutOf(name), P0 = personaById();
  const prompts = Object.fromEntries(finalPrompts().map((r) => [r.id, r])), base = Object.fromEntries(readL(`sut-${name}.jsonl`).map((s) => [s.id, s]));
  const file = `correct-${name}.jsonl`, done = new Set(readL(file).map((x) => x.id));
  // stratified sample: share of every topic x outcome kind, seeded
  const r = rng(5), share = Number(arg('share', '0.25'));
  const ids = idsOf(Object.keys(base).filter((id) => prompts[id]).map((id) => ({ id, persona: prompts[id].persona })), arg('split', 'all')).map((x) => x.id);
  const strata = groupBy(ids, (id) => prompts[id].topic + '|' + base[id].shown.kind);
  const sample = [];
  for (const k of Object.keys(strata).sort()) { const a = strata[k].slice().sort(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } sample.push(...a.slice(0, Math.max(1, Math.round(a.length * share)))); }
  const L = limiter(Math.max(2, Math.floor(conc / 2))); let stop = false;
  await Promise.all(sample.filter((id) => !done.has(id)).map((id) => L(async () => {
    if (stop) return;
    const pr = prompts[id], p = P0[pr.persona];
    let cur = base[id], typedNow = pr.getippt, kat = pr.kategorie, art = pr.spielart;
    const rounds = [];
    try {
      for (let round = 1; round <= 3; round++) {
        const doc = cur.out.options && cur.out.options[0] && cur.out.options[0].doc;
        const wishable = !!wishTypeOf(doc);
        const c = await api()({ role: 'persona-corr', model: 'claude-haiku-5-5', system: PERSONA_SYSTEM, user: corrUser(p, { ...pr, typedNow, kategorie: kat, spielart: art }, cur.shown.text, WAYS(cur.shown.kind, wishable), round), schema: CORR_SCHEMA, maxTokens: 1200, effort: 'medium' });
        if (!c.json) { rounds.push({ round, error: 'persona' }); break; }
        if (c.json.zufrieden || c.json.weg === 'fertig') { rounds.push({ round, satisfied: !!c.json.zufrieden, weg: 'fertig' }); break; }
        let weg = c.json.weg; if (weg === 'wunsch' && !wishable) weg = 'neu';
        let after, afterShown;
        if (weg === 'wunsch') {
          const idea = doc && doc.i ? sut.byId(doc.i) : null;
          const w = await sut.runWish(doc, c.json.text, pr.lang, idea ? String(idea.de.t).replace(/\|/g, ' ') : '');
          if (w.changes) {
            // the editor applies the changed fields to the card; what the description cannot show (colours, look) is listed
            const { doc: d2, rest } = applyWish(doc, w.changes);
            after = { out: { ...cur.out, options: [{ art: cur.out.options[0].art, doc: d2 }] }, shown: describe({ ...cur.out, options: [{ doc: d2 }] }, sut.byId, pr.lang) };
            afterShown = after.shown.text + (Object.keys(rest).length ? '\nAußerdem geändert: ' + JSON.stringify(rest) : '') + (w.note ? '\n(Notiz der KI: ' + w.note + ')' : '');
          } else { after = cur; afterShown = 'Der Wunsch kam nicht durch (' + (w.fail || 'leer') + '), die Karte bleibt wie vorher:\n' + cur.shown.text; }
        } else if (weg === 'neu') {
          typedNow = c.json.text;
          const out = await runOne(sut, { ...pr, typedNow, kategorie: kat, spielart: art }, P0);
          after = { out: { ...out, options: out.options && out.options.map((o) => ({ art: o.art, doc: o.doc })) }, shown: describe(out, sut.byId, pr.lang) };
          afterShown = after.shown.text;
        } else { after = cur; afterShown = cur.shown.text + '\n(Die Person ändert von Hand: ' + c.json.text + ')'; }
        const j = await api()({ role: 'judge-corr', model: JUDGE, system: CORR_JUDGE_SYSTEM, user: `Before:\n${cur.shown.text}\n\nCorrection (way: ${weg}): ${JSON.stringify(c.json.text)}\n\nAfter:\n${afterShown}`, schema: CORR_JUDGE_SCHEMA, maxTokens: 1200, effort: 'low' });
        const landed = j.json ? j.json.landed : null;
        rounds.push({ round, weg, text: c.json.text, landed, reason: j.json && j.json.reason, after: afterShown.slice(0, 600) });
        cur = after;
        if (landed !== null && landed >= 3) {
          // the persona looks once more: satisfied now?
          const c2 = await api()({ role: 'persona-corr', model: 'claude-haiku-5-5', system: PERSONA_SYSTEM, user: corrUser(p, { ...pr, typedNow, kategorie: kat, spielart: art }, cur.shown.text, WAYS(cur.shown.kind, !!wishTypeOf(cur.out.options && cur.out.options[0] && cur.out.options[0].doc)), round + 1), schema: CORR_SCHEMA, maxTokens: 1200, effort: 'medium' });
          if (c2.json && (c2.json.zufrieden || c2.json.weg === 'fertig')) { rounds.push({ round: round + 1, satisfied: !!c2.json.zufrieden, weg: 'fertig' }); break; }
        }
      }
      appendJsonl(P(file), { id, persona: pr.persona, topic: pr.topic, firstKind: base[id].shown.kind, rounds });
    } catch (e) { if (capHit(e)) { stop = true; log({ cap: true }); } else log({ id, err: e.message }); }
  })));
  console.log(JSON.stringify({ corrected: readL(file).length, usd: ledger.get().usd }));
}

// ---- compare two configs on a split --------------------------------------------------------------------------------------
function summary(name, split) {
  const g = gradesOf(name), sut = Object.fromEntries(readL(`sut-${name}.jsonl`).map((s) => [s.id, s]));
  const prompts = Object.fromEntries(finalPrompts().map((r) => [r.id, r]));
  const ids = idsOf(Object.keys(g).filter((id) => prompts[id] && sut[id]).map((id) => ({ id, persona: prompts[id].persona })), split).map((x) => x.id);
  const rew = Object.fromEntries(ids.map((id) => [id, rewardOf(g[id])])), pass = Object.fromEntries(ids.map((id) => [id, passOf(g[id])]));
  const usd = ids.reduce((s, id) => s + (sut[id].out.usd || 0), 0) / (ids.length || 1);
  return { ids, rew, pass, usd };
}
function stageCompare() {
  const a = summary(arg('a'), arg('split', 'val')), b = summary(arg('b'), arg('split', 'val'));
  const both = a.ids.filter((id) => b.ids.includes(id));
  const pick = (o) => Object.fromEntries(both.map((id) => [id, o[id]]));
  const mc = mcnemarPaired(pick(a.pass), pick(b.pass)), d = pairedDelta(pick(a.rew), pick(b.rew));
  const res = { a: arg('a'), b: arg('b'), split: arg('split', 'val'), n: both.length, pass_a: both.filter((id) => a.pass[id]).length / both.length, pass_b: both.filter((id) => b.pass[id]).length / both.length,
    reward_a: meanCi(both.map((id) => a.rew[id])), reward_b: meanCi(both.map((id) => b.rew[id])), delta: d, mcnemar: mc, usd_case_a: a.usd, usd_case_b: b.usd };
  // keep rule: significantly better on validation (McNemar p < 0.05 with c > b, or paired bootstrap CI of the reward above 0);
  // a change that costs > 15 % more per case must also gain >= 0.05 reward
  const better = (mc.p < 0.05 && mc.c > mc.b) || d.lo > 0;
  res.keep = better && !(res.usd_case_b > res.usd_case_a * 1.15 && d.delta < 0.05);
  console.log(JSON.stringify(res, null, 1));
  // --log "what changed": one line of the append-only iteration log (change, cost so far, scores, decision)
  if (arg('log')) appendJsonl(P('iterations.jsonl'), { at: new Date().toISOString(), change: arg('log'), from: res.a, to: res.b, split: res.split, n: res.n, pass: [res.pass_a, res.pass_b], reward: [res.reward_a.mean, res.reward_b.mean], delta: res.delta, mcnemar: { b: mc.b, c: mc.c, p: mc.p }, usd_case: [res.usd_case_a, res.usd_case_b], keep: res.keep, ledger_usd: ledger.get().usd });
  return res;
}

// --as NEW: the stored outcomes of config NAME shown again with the current renderer (no model call), e.g. after a renderer fix
async function stageRerender() {
  const name = arg('config'), as = arg('as'), k = await import(join(libOf(name), 'duell-karte.mjs')), P0 = personaById();
  const prompts = Object.fromEntries(readL('prompts.jsonl').map((r) => [r.id, r]));
  const rows = idsOf(readL(`sut-${name}.jsonl`).map((s) => ({ ...s, persona: s.persona })), arg('split', 'all'));
  for (const s of rows) appendJsonl(P(`sut-${as}.jsonl`), { ...s, shown: describe(s.out, (id) => k.App.D.byId(id), prompts[s.id].lang), rerenderedFrom: name });
  if (!existsSync(P(`cand/${as}`))) cpSync(P(`cand/${name}`), P(`cand/${as}`), { recursive: true });
  void P0;
  console.log(JSON.stringify({ rerendered: rows.length, as }));
}
// --file F: a reference corpus of real first-turn prompts (JSON array of { text }, read as data only). Style only: the same
// surface features on the whole text and on its first 40 words, and the realism judge's flags (typos, dialect, polish, list,
// politeness, LLM wording) on the first 40 words; the persona prompts are judged on the same window (they are shorter).
async function stageReference() {
  const rows = JSON.parse(readFileSync(resolve(arg('file')), 'utf8')).filter((r) => r && typeof r.text === 'string' && r.text.trim());
  const names = new Set();
  const head = (t) => t.trim().split(/\s+/).slice(0, 40).join(' ');
  const ref = rows.map((r, i) => ({ id: 'w' + String(i + 1).padStart(3, '0'), lang: 'de', getippt: head(r.text), full: r.text, v: 1 }));
  const flags = await judgeRealism(ref);
  const mine = finalPrompts().filter((r) => r.lang === 'de');
  const real = readJ('realism.json', {});
  const share = (rs, f) => (rs.length ? rs.filter(f).length / rs.length : 0);
  const fl = (rs, get) => Object.fromEntries(['typos', 'dialect', 'too_polished', 'list', 'over_polite', 'llm_phrasing'].map((k) => [k, share(rs, (r) => get(r) && get(r)[k])]));
  const rep = {
    source: 'allenai/WildChat-1M (ODC-BY), 100 deutsche erste Nutzer-Turns, Hugging Face datasets-server (erste Seite des Filters)',
    limit: 'Chat-Assistent-Nutzung (lange Aufgaben, viele Vorlagen/Bots): Referenz nur für Stil, nicht für die Länge in einem Ein-Satz-Feld einer App',
    n_ref: ref.length, n_mine_de: mine.length,
    // automated use: many rows share one prompt template (the same first six words); such rows say nothing about how people type
    distinct_openings: new Set(ref.map((r) => r.full.trim().split(/\s+/).slice(0, 6).join(' '))).size,
    top_template_share: Math.max(...Object.values(ref.reduce((m, r) => { const k = r.full.trim().split(/\s+/).slice(0, 6).join(' '); m[k] = (m[k] || 0) + 1; return m; }, {}))) / (ref.length || 1),
    ref_full: distribution(ref.map((r) => featuresOf(r.full, names))), ref_head40: distribution(ref.map((r) => featuresOf(r.getippt, names))),
    mine_de: distribution(mine.map((r) => featuresOf(r.getippt, names))),
    judge_flags_ref_head40: fl(ref, (r) => flags[r.id]), judge_flags_mine_de: fl(mine, (r) => real[r.id]),
    judge_human_ref_head40: meanCi(ref.filter((r) => flags[r.id]).map((r) => flags[r.id].human)),
  };
  writeJ('reference-report.json', rep);
  console.log(JSON.stringify(rep, (k, v) => (k === 'hist' ? undefined : v), 1));
}
function stageCost() { console.log(JSON.stringify(ledger.get(), null, 1)); }

const STAGES = { reference: stageReference, rerender: stageRerender, population: stagePopulation, prompts: stagePrompts, realism: stageRealism, 'realism-report': realismReport, candidate: stageCandidate, sut: stageSut, judge: stageJudge, calib: stageCalib, correct: stageCorrect, compare: stageCompare, cost: stageCost };
if (!STAGES[stage]) { console.error('stages: ' + Object.keys(STAGES).join(' | ')); process.exit(2); }
try { await STAGES[stage](); } catch (e) { if (capHit(e)) { console.error('cost cap reached: ' + ledger.get().usd.toFixed(4) + ' USD'); process.exit(3); } throw e; }
console.error('ledger: ' + ledger.get().usd.toFixed(4) + ' USD of ' + CAP);
