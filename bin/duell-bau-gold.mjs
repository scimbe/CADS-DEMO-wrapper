#!/usr/bin/env node
// Live evaluation of genre G3 against the frozen gold corpus (test/fixtures/bau-gold.json), through exactly the server's path:
// POST /api/duell/ai {kind:"karte", input:{art:"game", genre:"G3", text}} = createDuellAi().act (S0 access, S1 rules, S2
// classifier, S3 kit with checks, bot playtests and repair rounds, S4 output check, S5 seal) with the model layer
// lib/duell-llm.mjs (Claude Haiku 5.5, prompt cache, day/month budget). Scoring: lib/duell-bau-gold.mjs (executable checks).
//
//   node bin/duell-bau-gold.mjs --env-datei ~/DocFlow/.env --budget-datei /tmp/x/bau-budget.json [--nur g01,r03] [--out r.json] [--dry]
//
// --env-datei: a dotenv file; only ANTHROPIC_API_KEY is read from it, in memory, never printed or written. --budget-datei: the
// run's own budget file (never the production one; DUELL_CARD_BUDGET_USD default 2 for a run). --dry: a stub model that
// answers with the kit's own examples (no key, no cost) to check the runner. Prints numbers and the games' titles only.
import { readFileSync, writeFileSync } from 'node:fs';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { createLlm } from '../lib/duell-llm.mjs';
import { MOD_SYSTEM } from '../lib/duell-karte.mjs';
import { bewerte, zusammenfassung } from '../lib/duell-bau-gold.mjs';
import { BEISPIELE } from '../lib/vendor/mdi-baukasten/engines/baukasten/beispiele.js';
import { check } from '../lib/vendor/mdi-baukasten/engines/baukasten/check.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const has = (k) => process.argv.includes(k);
// --korpus test/fixtures/bau-dev.json (Tuning) | bau-gold.json (v1) | bau-gold-v2.json (Test); --split dev|test|test2
// --strategie repair|drafts, --beispiele basis|mehr (lib/duell-bau.mjs); --wdh n: jeden Satz n-mal (Streuung des Modells)
const KORPUS_PATH = arg('--korpus') || 'test/fixtures/bau-gold.json';
const KORPUS = JSON.parse(readFileSync(new URL('../' + KORPUS_PATH, import.meta.url), 'utf8'));
const nur = arg('--nur') ? new Set(arg('--nur').split(',')) : null;
const split = arg('--split'), wdh = Math.max(1, Number(arg('--wdh') || 1));
const entries = KORPUS.eintraege.filter((e) => (!nur || nur.has(e.id)) && (!split || e.split === split)).flatMap((e) => Array.from({ length: wdh }, (_, k) => (wdh > 1 ? { ...e, id: e.id + '.' + k } : e)));

function keyFrom(file) {
  const m = /^\s*ANTHROPIC_API_KEY\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(readFileSync(file, 'utf8'));
  if (!m) { console.error('ANTHROPIC_API_KEY fehlt in der env-Datei'); process.exit(2); }
  return m[1].trim();
}
function dryLlm() {
  return { configured: true, async generate(req) {
    if (req.system === MOD_SYSTEM) return { json: { risk: 0, cats: [], drink: 'none', takt: 'echtzeit', spiel: 'szene' }, stop: 'end_turn', usage: { in: 1, out: 1 } };
    if (req.name === 'bau_fakten') { const f = JSON.parse(req.user.slice(6, -7)); return { json: { items: f.map((x) => ({ i: x.i, grund: '', urteil: 'sicher', besser: '' })) }, stop: 'end_turn', usage: { in: 1, out: 1 } }; }
    const ex = /zug/.test(req.name) ? BEISPIELE.memory : BEISPIELE.flappy;
    return { json: { ok: true, ...check(ex).desc }, stop: 'end_turn', usage: { in: 1, out: 1 } };
  } };
}
let base;
if (has('--dry')) base = dryLlm();
else {
  const budgetFile = arg('--budget-datei');
  if (!budgetFile || /prod/i.test(budgetFile)) { console.error('--budget-datei fehlt (eigene Datei je Lauf, nie die Produktivdatei)'); process.exit(2); }
  base = createLlm({ env: { DUELL_CARD_PROVIDER: 'anthropic', DUELL_CARD_MODEL: process.env.DUELL_CARD_MODEL || 'claude-haiku-5-5', ANTHROPIC_API_KEY: keyFrom(arg('--env-datei')),
    DUELL_CARD_BUDGET_USD: process.env.DUELL_CARD_BUDGET_USD || '2', DUELL_CARD_BUDGET_FILE: budgetFile, DUELL_CARD_BUDGET_MONTH_USD: process.env.DUELL_CARD_BUDGET_MONTH_USD || '5' }, log: () => {} });
}
// every call is counted (usage, dollars, the model's game answers for the report)
let cur = null;
const llm = { configured: true, async generate(req) {
  const t0 = Date.now(), r = await base.generate(req);
  if (cur) { cur.calls.push({ name: req.name, stop: r.stop, ms: Date.now() - t0, usage: r.usage, usd: r.usd || 0 }); if (/^card_bau/.test(req.name) && r.json) cur.antworten.push({ name: req.name, json: r.json }); }
  return r;
} };
const d = createDuell({ env: { DUELL_DAILY_MAX: '100000', DUELL_SEAL_SECRET: 'gold-run' }, salt: 'gold', log: () => {}, llm: async () => '{}' });
d.shared.age16 = () => true; d.shared.age18 = () => false;
let who = 'gold@example.org';
const ai = createDuellAi({ env: { DUELL_AI_SALT: 'gold', DUELL_AI_PROOF_BITS: '0', DUELL_CREATE_FREE: '100000', DUELL_CREATE_CALLS_PER_DAY: '100000', DUELL_CREATE_BLOCKS_PER_DAY: '100000', DUELL_CREATE_NEW_PER_HOUR: '100000', DUELL_BAU_STRATEGIE: arg('--strategie'), DUELL_BAU_BEISPIELE: arg('--beispiele') },
  llm: async () => '{}', cardLlm: llm, shared: d.shared, auth: { mode: 'gate', identify: async () => ({ email: who }) }, log: () => {} });

// the last round's whole description: a realtime game comes in two steps (scene, then spawn + rules)
function letzte(a) {
  const last = (n) => [...a].reverse().find((x) => x.name === n);
  const z = last('card_bau_zug'); if (z) return z.json;
  const sz = last('card_bau_szene'), rg = last('card_bau_regeln');
  return sz ? { ...sz.json, ...(rg ? { spawn: rg.json.spawn, rules: rg.json.rules } : {}) } : null;
}
const rows = [];
for (const [i, e] of entries.entries()) {
  who = 'gold' + i + '@example.org';
  cur = { calls: [], antworten: [] };
  const b = { kind: 'karte', input: { text: e.satz, art: 'game', genre: 'G3' }, device: String(i).padStart(32, '0').slice(-32).replace(/\d/g, (c) => 'abcdefghij'[c]), lang: e.lang };
  const t0 = Date.now();
  let r;
  try { r = await ai.act(b, await ai.who({}, b), null); } catch (err) { r = { status: 0, body: { error: String(err && err.message) } }; }
  const bew = bewerte(e, r.status, r.body), o = r.body && r.body.options && r.body.options[0];
  const row = { id: e.id, split: e.split, satz: e.satz, erwartet: e.erwartet, status: r.status, bewertung: bew, titel: o ? o.doc.t : '', ziel: o ? o.doc.b.goal || '' : '', note: r.body.note || [], absage: r.body.notyet ? { notyet: r.body.notyet, reason: r.body.reason, alt: r.body.alt } : null, error: r.body.error || '', ms: Date.now() - t0, aufrufe: cur.calls, usd: cur.calls.reduce((s, c) => s + c.usd, 0), spiel: o ? o.doc.b : null, letzteAntwort: !o && cur.antworten.length ? letzte(cur.antworten) : null };
  rows.push(row);
  console.log(`${e.id} ${e.split} ${bew.ergebnis.padEnd(6)} ${bew.ok ? 'ok ' : 'NEIN'} ${bew.passt ? 'passt' : '     '} ${String(cur.calls.length).padStart(2)} Aufrufe ${(row.usd * 100).toFixed(2)} ct ${row.ms} ms  ${e.satz.slice(0, 50)} -> ${row.titel || (row.absage ? row.absage.reason || row.absage.notyet.what + ':' + (row.absage.notyet.name || '') : row.error || r.status)}`);
}
const sum = zusammenfassung(rows);
sum.usd = Math.round(rows.reduce((s, r) => s + r.usd, 0) * 10000) / 10000;
sum.aufrufe = rows.reduce((s, r) => s + r.aufrufe.length, 0);
sum.cacheRead = rows.flatMap((r) => r.aufrufe).reduce((s, c) => s + ((c.usage && c.usage.cacheRead) || 0), 0);
console.log(JSON.stringify(sum, null, 1));
if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify({ korpus: KORPUS_PATH, split: split || 'alle', strategie: arg('--strategie') || 'repair', beispiele: arg('--beispiele') || 'basis', wdh, modell: has('--dry') ? 'dry' : (process.env.DUELL_CARD_MODEL || 'claude-haiku-5-5'), zeit: new Date().toISOString(), zusammenfassung: sum, zeilen: rows }, null, 1) + '\n');
