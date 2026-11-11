#!/usr/bin/env node
// Harness swarm: the result file of a run (eval/results/). Reads only the run folder, calls no model.
//   node eval/report.mjs --run eval/runs/main --base base --final NAME --out eval/results/harness-swarm-2026-11-11
// Writes <out>.json (all numbers) and <out>.md (the same, as tables). LLM-judged numbers, not gold labels.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { rewardOf, passOf, meanCi, pairedDelta, groupBy, WEIGHTS, PASS_AT } from './lib/stats.mjs';
import { createLedger } from './lib/api.mjs';
import { mcnemarPaired, wilsonLower, wilsonUpper } from '../lib/harness-stats.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const RUN = resolve(arg('run', 'eval/runs/main')), BASE = arg('base', 'base'), FINAL = arg('final', BASE), OUT = resolve(arg('out', 'eval/results/harness-swarm'));
// the correction runs may carry other names than the configs compared (base over all splits, the final config on test)
const CORR_BASE = arg('correct-base', BASE), CORR_FINAL = arg('correct-final', FINAL);
const P = (f) => join(RUN, f);
const readJ = (f, d) => (existsSync(P(f)) ? JSON.parse(readFileSync(P(f), 'utf8')) : d);
const readL = (f) => (existsSync(P(f)) ? readFileSync(P(f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const EUR = 0.92;

const personas = Object.fromEntries(readJ('personas.json', []).map((p) => [p.id, p])), split = readJ('split.json', {});
const splitOf = (pid) => Object.keys(split).find((k) => split[k].includes(pid));
const last = {}; for (const r of readL('prompts.jsonl')) last[r.id] = r;
const real = readJ('realism.json', {});
const prompts = Object.fromEntries(Object.values(last).filter((r) => !r.error && real[r.id] && real[r.id].v === r.v && real[r.id].human >= 3).map((r) => [r.id, r]));
const grades = (n) => { const g = {}; for (const x of readL(`grades-${n}.jsonl`)) if (!x.error) g[x.id] = x; return g; };
const suts = (n) => Object.fromEntries(readL(`sut-${n}.jsonl`).map((s) => [s.id, s]));
const pct = (x) => (100 * x).toFixed(1) + ' %';
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '-');

function table(gr, ids) {
  const rs = ids.map((id) => rewardOf(gr[id])), ps = ids.filter((id) => passOf(gr[id])).length;
  const m = meanCi(rs);
  const dims = Object.fromEntries(Object.keys(WEIGHTS).map((d) => [d, meanCi(ids.map((id) => gr[id][d])).mean]));
  return { n: ids.length, reward: m.mean, reward_lo: m.lo, reward_hi: m.hi, pass: ids.length ? ps / ids.length : 0, pass_lo: wilsonLower(ps, ids.length), pass_hi: wilsonUpper(ps, ids.length), ...dims };
}
function breakdown(name, splitName) {
  const gr = grades(name), s = suts(name);
  const ids = Object.keys(gr).filter((id) => prompts[id] && s[id] && (!splitName || splitOf(prompts[id].persona) === splitName));
  const by = (fn) => Object.fromEntries(Object.entries(groupBy(ids, fn)).sort().map(([k, v]) => [k, table(gr, v)]));
  const p = (id) => personas[prompts[id].persona];
  return {
    all: table(gr, ids),
    category: by((id) => prompts[id].kategorie.replace('Card', 'Karte').replace('Game', 'Spiel').replace('Like a card', 'Wie eine Karte')),
    topic: by((id) => prompts[id].topic),
    band: by((id) => p(id).band), lang: by((id) => p(id).lang), digital: by((id) => p(id).digital),
    daz: by((id) => (/A2|B1|B2/.test(p(id).mig) || /German A2|German B1/.test(p(id).life) ? 'DaZ/2nd language' : 'L1')),
    outcome: by((id) => s[id].shown.kind),
    failures: Object.fromEntries(Object.entries(groupBy(ids, (id) => gr[id].failure || 'none')).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1])),
    usd_case: ids.reduce((x, id) => x + (s[id].out.usd || 0), 0) / (ids.length || 1),
  };
}
function examples(name, failure, n = 4) {
  const gr = grades(name), s = suts(name);
  return Object.keys(gr).filter((id) => prompts[id] && s[id] && gr[id].failure === failure).sort().slice(0, n)
    .map((id) => ({ id, kategorie: prompts[id].kategorie + (prompts[id].spielart !== '-' ? '/' + prompts[id].spielart : ''), typed: prompts[id].getippt, shown: s[id].shown.text.split('\n')[0].slice(0, 160), reason: gr[id].reason, expected: gr[id].expected }));
}
function compareOn(a, b, splitName) {
  const ga = grades(a), gb = grades(b);
  const ids = Object.keys(gb).filter((id) => ga[id] && prompts[id] && splitOf(prompts[id].persona) === splitName);
  const pa = Object.fromEntries(ids.map((id) => [id, passOf(ga[id])])), pb = Object.fromEntries(ids.map((id) => [id, passOf(gb[id])]));
  const ra = Object.fromEntries(ids.map((id) => [id, rewardOf(ga[id])])), rb = Object.fromEntries(ids.map((id) => [id, rewardOf(gb[id])]));
  return { split: splitName, n: ids.length, a: table(ga, ids), b: table(gb, ids), delta: pairedDelta(ra, rb), mcnemar: mcnemarPaired(pa, pb) };
}
function corrections(name, splitName) {
  const rows = readL(`correct-${name}.jsonl`).filter((r) => !splitName || splitOf(r.persona) === splitName);
  const tried = rows.filter((r) => r.rounds.some((x) => x.weg && x.weg !== 'fertig'));
  const landedIn = (r, k) => r.rounds.filter((x) => x.round <= k).some((x) => x.landed >= 3);
  const byWay = groupBy(rows.flatMap((r) => r.rounds.filter((x) => x.landed != null)), (x) => x.weg);
  return {
    sampled: rows.length, satisfied_first: rows.filter((r) => r.rounds[0] && r.rounds[0].weg === 'fertig' && r.rounds[0].satisfied).length, tried: tried.length,
    landed_round1: tried.filter((r) => landedIn(r, 1)).length, landed_by_round3: tried.filter((r) => landedIn(r, 3)).length,
    landed_ci: [wilsonLower(tried.filter((r) => landedIn(r, 3)).length, tried.length), wilsonUpper(tried.filter((r) => landedIn(r, 3)).length, tried.length)],
    rounds_to_land: meanCi(tried.filter((r) => landedIn(r, 3)).map((r) => r.rounds.find((x) => x.landed >= 3).round)).mean,
    by_way: Object.fromEntries(Object.entries(byWay).map(([k, v]) => [k, { n: v.length, landed_mean: meanCi(v.map((x) => x.landed)).mean, landed_ge3: v.filter((x) => x.landed >= 3).length / v.length }])),
    by_first_kind: Object.fromEntries(Object.entries(groupBy(tried, (r) => r.firstKind)).map(([k, v]) => [k, { n: v.length, landed: v.filter((r) => landedIn(r, 3)).length }])),
    examples: tried.slice(0, 40).filter((r, i) => i % 5 === 0).map((r) => ({ id: r.id, rounds: r.rounds.map((x) => ({ weg: x.weg, text: x.text, landed: x.landed, reason: x.reason })) })),
  };
}

const ledger = createLedger(P('ledger.json'), 43).get(), rr = readJ('realism-report.json', {}), calib = readJ('calib-report.json', {});
const iters = readL('iterations.jsonl');
const finals = FINAL !== BASE ? { val: compareOn(BASE, FINAL, 'val'), test: compareOn(BASE, FINAL, 'test'), train: compareOn(BASE, FINAL, 'train') } : null;
const top = Object.entries(breakdown(BASE).failures).filter(([k]) => k !== 'none').slice(0, 6).map(([k, n]) => ({ failure: k, n, examples: examples(BASE, k) }));
const out = {
  note: 'LLM-judged evaluation (judge claude-sonnet-5-5, calibrated against claude-opus-5-5). Not a gold-label result; the human gold corpus stays open.',
  cost: { usd: ledger.usd, eur: ledger.usd * EUR, byRole: ledger.byRole, cap_usd: 43 },
  realism: rr, calibration: calib,
  base: { all: breakdown(BASE), test: breakdown(BASE, 'test') }, final: FINAL !== BASE ? { name: FINAL, all: breakdown(FINAL), test: breakdown(FINAL, 'test') } : null, compare: finals,
  top_failures: top, corrections: { base_test: corrections(CORR_BASE, 'test'), ...(existsSync(P(`correct-${CORR_FINAL}.jsonl`)) ? { final_test: corrections(CORR_FINAL, 'test') } : {}) }, iterations: iters,
  weights: WEIGHTS, pass_at: PASS_AT,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT + '.json', JSON.stringify(out, null, 1));

// ---- markdown --------------------------------------------------------------------------------------------------------
const L = [];
const row = (k, t) => `| ${k} | ${t.n} | ${f2(t.reward)} [${f2(t.reward_lo)}–${f2(t.reward_hi)}] | ${pct(t.pass)} [${pct(t.pass_lo)}–${pct(t.pass_hi)}] | ${t.intent.toFixed(2)} | ${t.vorstellung.toFixed(2)} | ${t.routing.toFixed(2)} | ${t.quality.toFixed(2)} |`;
const tab = (title, o) => { L.push(`\n**${title}**\n`, '| | n | Reward [95 % CI] | Pass [Wilson 95 %] | Intent | Vorstellung | Routing | Qualität |', '|---|---|---|---|---|---|---|---|'); for (const [k, t] of Object.entries(o)) L.push(row(k, t)); };
L.push('# Harness-Swarm freie Karte – Ergebnis', '', '> LLM-bewertet (Judge Claude Sonnet 5.5, kalibriert gegen Claude Opus 5.5). Kein Ergebnis gegen Gold-Labels; das menschliche Gold-Korpus bleibt offen und nicht eingefroren.', '');
L.push(`Kosten: ${ledger.usd.toFixed(2)} USD (≈ ${(ledger.usd * EUR).toFixed(2)} EUR bei 0,92), harte Grenze 43 USD.`, '');
L.push('| Rolle | Aufrufe | USD |', '|---|---|---|', ...Object.entries(ledger.byRole || {}).map(([k, v]) => `| ${k} | ${v.calls} | ${v.usd.toFixed(3)} |`));
L.push('', `Gewichte: ${Object.entries(WEIGHTS).map(([k, v]) => k + ' ' + v).join(', ')}; Routing 0 (falscher Ersatz) deckelt den Reward bei 0,25; bestanden = Reward ≥ ${PASS_AT} und Routing ≥ 2.`);
const b = out.base.all;
tab('Baseline (alle Splits) nach Kategorie', b.category); tab('Baseline nach Thema', b.topic); tab('Baseline nach Altersband', b.band); tab('Baseline nach Sprache / DaZ / Digitalkompetenz', { ...b.lang, ...b.daz, ...Object.fromEntries(Object.entries(b.digital).map(([k, v]) => ['digital ' + k, v])) });
tab('Baseline nach Ergebnis-Art', b.outcome);
if (out.final) { tab(`Final „${FINAL}“ (alle Splits) nach Kategorie`, out.final.all.category); tab(`Final „${FINAL}“ nach Thema`, out.final.all.topic); }
if (finals) {
  L.push('\n**Baseline gegen Final, gepaart (gleiche Prompts)**\n', '| Split | n | Reward base → final | Δ [Bootstrap 95 %] | Pass base → final | McNemar b/c, p |', '|---|---|---|---|---|---|');
  for (const c of Object.values(finals)) L.push(`| ${c.split} | ${c.n} | ${f2(c.a.reward)} → ${f2(c.b.reward)} | ${f2(c.delta.delta)} [${f2(c.delta.lo)}–${f2(c.delta.hi)}] | ${pct(c.a.pass)} → ${pct(c.b.pass)} | ${c.mcnemar.b}/${c.mcnemar.c}, p=${c.mcnemar.p.toPrecision(2)} |`);
}
L.push('\n**Häufigste Fehlerbilder (Baseline)**\n');
for (const t of top) { L.push(`- **${t.failure}** (${t.n})`); for (const e of t.examples) L.push(`  - ${e.id} [${e.kategorie}] „${e.typed}“ → ${e.shown} — ${e.reason}`); }
// realism, coverage, calibration, corrections, iterations
if (rr.surface) {
  const sh = rr.surface.shares, fl = rr.flags_accepted;
  L.push('\n**Realismus der Prompts** (Judge-Rubrik 1–5, ≥ 3 angenommen; Oberflächenmerkmale deterministisch)\n');
  L.push(`erzeugt ${rr.generated_v1}, neu gezogen ${rr.resampled}, angenommen ${rr.accepted}, abgelehnt ${rr.rejected_final}; Mittel ${f2(rr.human_score_accepted.mean)} [${f2(rr.human_score_accepted.lo)}–${f2(rr.human_score_accepted.hi)}]`);
  L.push(`Wörter p10/p50/p90: ${rr.surface.words.p10}/${rr.surface.words.p50}/${rr.surface.words.p90}; Histogramm ${JSON.stringify(rr.surface.hist)}`);
  L.push(`Anteile: alles klein ${pct(sh.allLower)}, Emoji ${pct(sh.emoji)}, Frage ${pct(sh.question)}, Imperativ ${pct(sh.imperative)}, Bitte/Höflich ${pct(sh.polite)}, Familie/Rolle ${pct(sh.family)}, Satzzeichen am Ende ${pct(sh.endPunct)}, Liste ${pct(sh.listy)}; Judge: Tippfehler ${pct(fl.typos)}, Dialekt ${pct(fl.dialect)}, zu glatt ${pct(fl.too_polished)}, LLM-Formulierung ${pct(fl.llm_phrasing)}`);
  L.push('Referenz (Größenordnung, kein Korpusvergleich): Websuche 2,2–2,8 Wörter je Anfrage (Jansen/Spink, Excite 1997–2001; Dogpile 2005); LLM-Chat-Prompts im Mittel 69,5 Llama-2-Token, stark rechtsschief (LMSYS-Chat-1M, Zheng et al. 2023). Ein Ein-Satz-Feld einer App liegt erwartbar dazwischen.');
  const bands = Object.keys(rr.coverage_band_lang_x_topic).sort(), topics = [...new Set(bands.flatMap((b) => Object.keys(rr.coverage_band_lang_x_topic[b])))].sort();
  L.push('\n**Abdeckung Altersband|Sprache × Thema (angenommene Prompts)**\n', '| | ' + topics.join(' | ') + ' |', '|---|' + topics.map(() => '---').join('|') + '|');
  for (const b of bands) L.push(`| ${b} | ` + topics.map((t) => rr.coverage_band_lang_x_topic[b][t] || 0).join(' | ') + ' |');
}
const refr = readJ('reference-report.json', null);
if (refr) {
  L.push('\n**Stil-Abgleich mit echten Prompts (WildChat-DE)**\n', `Quelle: ${refr.source}. Lizenz ODC-BY; Zitat: Zhao et al., „WildChat: 1M ChatGPT Interaction Logs in the Wild“, ICLR 2024. Einschränkung: ${refr.limit}.`);
  L.push(`Von ${refr.n_ref} Zeilen haben nur ${refr.distinct_openings} verschiedene Anfänge; ${pct(refr.top_template_share)} stammen aus einer einzigen automatisierten Vorlage („Gib mir nur 10 Keywords …“). Der Auszug taugt daher nicht als Referenz für menschlichen Stil: Kleinschreibung ${pct(refr.ref_full.shares.allLower)} (Personas ${pct(refr.mine_de.shares.allLower)}), Emoji ${pct(refr.ref_full.shares.emoji)} (${pct(refr.mine_de.shares.emoji)}), Imperativ ${pct(refr.ref_full.shares.imperative)} (${pct(refr.mine_de.shares.imperative)}), Liste ${pct(refr.ref_full.shares.listy)} (${pct(refr.mine_de.shares.listy)}); Judge auf den ersten 40 Wörtern: Tippfehler ${pct(refr.judge_flags_ref_head40.typos)} (${pct(refr.judge_flags_mine_de.typos)}), LLM-artig ${pct(refr.judge_flags_ref_head40.llm_phrasing)} (${pct(refr.judge_flags_mine_de.llm_phrasing)}). Entscheidung: keine Neugewichtung der Personas; ein brauchbarer Vergleich braucht mehr Seiten des Filters mit Entfernen der Vorlagen (Duplikate nach Anfang) oder echte, datenschutzkonforme Eingaben der App.`);
}
for (const [lab, v] of Object.entries(calib)) {
  L.push(`\n**Judge-Kalibrierung ${lab}** (n=${v.n}): bestanden κ=${v.pass.kappa.toFixed(2)} (Übereinstimmung ${pct(v.pass.po)}), Fehlerbild gleich ${pct(v.failure_tag_agree)}; ` + ['intent', 'vorstellung', 'routing', 'quality'].map((d) => `${d} κw=${v[d].kappa_w} exakt ${pct(v[d].exact)}`).join(', ') + (v.low_agreement.length ? '; schwach: ' + v.low_agreement.join(', ') : ''));
}
for (const [k, c] of Object.entries(out.corrections)) {
  if (!c || !c.sampled) continue;
  L.push(`\n**Korrektur ${k}**: Stichprobe ${c.sampled}, sofort zufrieden ${c.satisfied_first}, korrigiert ${c.tried}; angekommen (≥ 3/4) nach Runde 1: ${c.landed_round1}, bis Runde 3: ${c.landed_by_round3} (${pct(c.landed_by_round3 / (c.tried || 1))}, Wilson ${pct(c.landed_ci[0])}–${pct(c.landed_ci[1])}), Runden bis Erfolg ${c.rounds_to_land.toFixed(2)}; je Weg: ` + Object.entries(c.by_way).map(([w, x]) => `${w} n=${x.n} ≥3: ${pct(x.landed_ge3)}`).join(', '));
}
L.push('\n**Iterationen (Append-only-Log, eval/runs/main/iterations.jsonl)**\n', '| Änderung | Split | n | Pass vorher → nachher | Δ Reward [95 %] | McNemar b/c p | behalten |', '|---|---|---|---|---|---|---|');
for (const it of iters) L.push(`| ${it.change} | ${it.split} | ${it.n} | ${pct(it.pass[0])} → ${pct(it.pass[1])} | ${f2(it.delta.delta)} [${f2(it.delta.lo)}–${f2(it.delta.hi)}] | ${it.mcnemar.b}/${it.mcnemar.c} p=${Number(it.mcnemar.p).toPrecision(2)} | ${it.keep ? 'ja' : 'nein'} |`);
writeFileSync(OUT + '.md', L.join('\n') + '\n');
console.log(JSON.stringify({ out: OUT, base: b.all, final: out.final && out.final.all.all, compare: finals && Object.fromEntries(Object.entries(finals).map(([k, v]) => [k, { d: v.delta, p: v.mcnemar.p }])) }, null, 1));
