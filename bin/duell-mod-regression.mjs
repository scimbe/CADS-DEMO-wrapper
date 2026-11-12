#!/usr/bin/env node
// Live regression of the shared classifier S2/S4 (MOD_SYSTEM, lib/duell-karte.mjs) against the frozen set
// test/fixtures/mod-regression.json: harmless wishes and built games that must never cost a strike, and clear violations that
// must. One classifier call per entry (cached prefix, Haiku), the verdict through exactly the server's policy:
//   REQUEST: verdictOf -> ok | softOfVerdict (honest refusal, no strike) | strike
//   CARD:    verdictOf -> ok | grenzOf (honest refusal, no strike) | strike
//
//   node bin/duell-mod-regression.mjs --env-datei ~/DocFlow/.env --budget-datei /tmp/x/mod-budget.json [--nur fp-v040,r-v131] [--wdh 3] [--out r.json] [--dry]
//
// --env-datei: a dotenv file; only ANTHROPIC_API_KEY is read from it, in memory, never printed or written. --budget-datei: the
// run's own budget file (never the production one; DUELL_CARD_BUDGET_USD default 0.5). --dry: a stub model (risk 0) to check
// the runner without key or cost. Exit 1 when an entry misses its expectation. Prints numbers and the missed entries only.
import { readFileSync, writeFileSync } from 'node:fs';
import { createLlm } from '../lib/duell-llm.mjs';
import * as K from '../lib/duell-karte.mjs';

const { MOD_SCHEMA, MOD_SYSTEM, softOfVerdict, verdictOf } = K;
// a checkout without grenzOf (before this policy): every S4 refusal is a strike, for the comparison run
const grenzOf = K.grenzOf || (() => '');

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const has = (k) => process.argv.includes(k);
const SET = JSON.parse(readFileSync(new URL('../test/fixtures/mod-regression.json', import.meta.url), 'utf8'));
const nur = arg('--nur') ? new Set(arg('--nur').split(',')) : null, wdh = Math.max(1, Number(arg('--wdh') || 1));
const entries = SET.eintraege.filter((e) => !nur || nur.has(e.id));

function keyFrom(file) {
  const m = /^\s*ANTHROPIC_API_KEY\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(readFileSync(file, 'utf8'));
  if (!m) { console.error('ANTHROPIC_API_KEY fehlt in der env-Datei'); process.exit(2); }
  return m[1].trim();
}
let llm;
if (has('--dry')) llm = { async generate() { return { json: { risk: 0, cats: [], drink: 'none' }, stop: 'end_turn', usage: { in: 1, out: 1 }, usd: 0 }; } };
else {
  const budgetFile = arg('--budget-datei');
  if (!budgetFile || /prod/i.test(budgetFile)) { console.error('--budget-datei fehlt (eigene Datei je Lauf, nie die Produktivdatei)'); process.exit(2); }
  llm = createLlm({ env: { DUELL_CARD_PROVIDER: 'anthropic', DUELL_CARD_MODEL: process.env.DUELL_CARD_MODEL || 'claude-haiku-5-5', ANTHROPIC_API_KEY: keyFrom(arg('--env-datei')),
    DUELL_CARD_BUDGET_USD: process.env.DUELL_CARD_BUDGET_USD || '0.5', DUELL_CARD_BUDGET_FILE: budgetFile, DUELL_CARD_BUDGET_MONTH_USD: process.env.DUELL_CARD_BUDGET_MONTH_USD || '2' }, log: () => {} });
}
const H = { firstNames: new Set() };
/** The server's policy on one classifier answer -> 'frei' | 'weich' (honest refusal, no strike) | 'strike' */
export function klasse(e, r) {
  const v = verdictOf(r);
  if (v.ok) return 'frei';
  if (v.crisis) return 'strike';
  return (e.was === 'CARD' ? grenzOf(v, e.text, H) : softOfVerdict(v, { text: e.text }, H)) ? 'weich' : 'strike';
}
const rows = [];
let usd = 0;
for (const e of entries) {
  for (let k = 0; k < wdh; k++) {
    const r = await llm.generate({ system: MOD_SYSTEM, user: `${e.was} <data>${JSON.stringify(e.text)}</data>`, schema: MOD_SCHEMA, name: 'check', maxTokens: 800, timeoutMs: 30000 }).catch((err) => ({ json: null, stop: 'error:' + (err && err.code || 'x') }));
    usd += r.usd || 0;
    const kl = klasse(e, r), ok = e.soll === 'strike' ? kl === 'strike' : kl !== 'strike';
    rows.push({ id: e.id, k, was: e.was, soll: e.soll, klasse: kl, ok, risk: r.json ? r.json.risk : null, cats: r.json ? r.json.cats : null, stop: r.stop });
  }
}
const sum = {};
for (const x of rows) { const s = (sum[x.was + '/' + x.soll] ||= { n: 0, frei: 0, weich: 0, strike: 0, verfehlt: 0 }); s.n++; s[x.klasse]++; if (!x.ok) s.verfehlt++; }
console.log(JSON.stringify({ modell: has('--dry') ? 'dry' : process.env.DUELL_CARD_MODEL || 'claude-haiku-5-5', n: rows.length, usd: Math.round(usd * 1e5) / 1e5, sum }, null, 1));
for (const x of rows.filter((x) => !x.ok)) console.log('VERFEHLT', x.id, x.was, 'soll', x.soll, 'ist', x.klasse, 'risk', x.risk, (x.cats || []).join('+'));
if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify({ zeit: new Date().toISOString(), usd, rows }, null, 1) + '\n');
process.exit(rows.some((x) => !x.ok) ? 1 : 0);
