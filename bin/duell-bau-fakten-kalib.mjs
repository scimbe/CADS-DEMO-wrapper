#!/usr/bin/env node
// Calibration of the quiz fact check (lib/duell-bau-fakten.mjs) against a person.
//   node bin/duell-bau-fakten-kalib.mjs pruefen --set S.json --env-datei ~/DocFlow/.env --budget-datei /tmp/x/b.json --out U.json
//       runs the checker once per original game (the questions of one quiz together, as in production) and writes its verdicts.
//       The verdicts are kept OUT of the rating sheet so the person is not anchored on them.
//   node bin/duell-bau-fakten-kalib.mjs vergleich --set S.json --urteile U.json --csv bewertet.csv
//       compares with the person's rating; refuses while a row or the rater name is missing.
// Until a person has rated the set, DUELL_BAU_FAKTEN stays "vorschlag" (the check only reports).
// --env-datei: only ANTHROPIC_API_KEY is read, in memory, never printed or written.
import { readFileSync, writeFileSync } from 'node:fs';
import { createLlm } from '../lib/duell-llm.mjs';
import { pruefeFakten, leseCsv, vergleiche } from '../lib/duell-bau-fakten.mjs';
import { cohenKappa } from '../lib/duell-bau-gold.mjs';

const argv = process.argv.slice(2), cmd = argv[0];
const arg = (k) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : undefined; };
const set = JSON.parse(readFileSync(arg('--set'), 'utf8')).fragen;

if (cmd === 'pruefen') {
  const env = readFileSync(arg('--env-datei'), 'utf8'), m = /^\s*ANTHROPIC_API_KEY\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(env);
  if (!m) { console.error('ANTHROPIC_API_KEY fehlt in der env-Datei'); process.exit(2); }
  const budgetFile = arg('--budget-datei');
  if (!budgetFile || /prod/i.test(budgetFile)) { console.error('--budget-datei fehlt (eigene Datei, nie die Produktivdatei)'); process.exit(2); }
  const llm = createLlm({ env: { DUELL_CARD_PROVIDER: 'anthropic', DUELL_CARD_MODEL: process.env.DUELL_CARD_MODEL || 'claude-haiku-5-5', ANTHROPIC_API_KEY: m[1].trim(),
    DUELL_CARD_BUDGET_USD: '0.5', DUELL_CARD_BUDGET_FILE: budgetFile, DUELL_CARD_BUDGET_MONTH_USD: '1' }, log: () => {} });
  const games = new Map();
  for (const f of set) { if (!games.has(f.id)) games.set(f.id, []); games.get(f.id).push(f); }
  const out = []; let usd = 0, calls = 0;
  for (const fs of games.values()) {
    const r = await pruefeFakten({ generate: async (req) => { const x = await llm.generate(req); usd += x.usd || 0; calls++; return x; } }, null, fs.map((f, i) => ({ i, art: f.art, q: f.q, a: f.a, wrong: f.wrong })));
    r.urteile.forEach((u, i) => out.push({ nr: fs[i].nr, urteil: u.urteil, grund: u.grund, besser: u.besser, ok: r.ok }));
  }
  out.sort((a, b) => a.nr.localeCompare(b.nr));
  writeFileSync(arg('--out'), JSON.stringify({ modell: process.env.DUELL_CARD_MODEL || 'claude-haiku-5-5', zeit: new Date().toISOString(), aufrufe: calls, usd, urteile: out }, null, 1) + '\n');
  const c = (k) => out.filter((u) => u.urteil === k).length;
  console.log(JSON.stringify({ n: out.length, sicher: c('sicher'), unsicher: c('unsicher'), falsch: c('falsch'), aufrufe: calls, usd: Number(usd.toFixed(4)) }));
} else if (cmd === 'vergleich') {
  const mensch = leseCsv(readFileSync(arg('--csv'), 'utf8'));
  const wer = [...new Set(mensch.map((r) => r.bewertet_von).filter(Boolean))];
  if (!wer.length) { console.error('Spalte bewertet_von ist leer: ohne benannte Person keine Kalibrierung'); process.exit(2); }
  if (mensch.length !== set.length) { console.error(`CSV hat ${mensch.length} Zeilen, Satz hat ${set.length}`); process.exit(2); }
  const u = JSON.parse(readFileSync(arg('--urteile'), 'utf8')).urteile;
  console.log(JSON.stringify({ bewertet_von: wer, ...vergleiche(mensch, u, cohenKappa) }, null, 1));
} else { console.error('pruefen | vergleich'); process.exit(2); }
