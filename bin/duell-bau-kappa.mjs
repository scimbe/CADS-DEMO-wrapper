#!/usr/bin/env node
// Second rater for the G3 gold runs: agreement between the automatic check (all expected properties, lib/duell-bau-gold.mjs)
// and an independent rater with its own rubric (binary: "the game is what the sentence means and fits the audience").
//
//   node bin/duell-bau-kappa.mjs --lauf r.json --liste fuer-bewerter.json      export: sentence + game in plain words, no verdict
//   node bin/duell-bau-kappa.mjs --lauf r.json --urteile urteile.json [--out k.json]   kappa, agreement, table, disagreements
// urteile.json: { "<id>": true | false, ... } for every exported game. Only games that were delivered are rated.
import { readFileSync, writeFileSync } from 'node:fs';
import { cohenKappa, spielText } from '../lib/duell-bau-gold.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const lauf = JSON.parse(readFileSync(arg('--lauf'), 'utf8'));
const games = lauf.zeilen.filter((r) => r.spiel && r.erwartet.ergebnis === 'spiel');
if (arg('--liste')) {
  writeFileSync(arg('--liste'), JSON.stringify(games.map((r) => ({ id: r.id, satz: r.satz, spiel: spielText(r.spiel) })), null, 1) + '\n');
  console.log(`${games.length} Spiele exportiert`);
} else {
  const u = JSON.parse(readFileSync(arg('--urteile'), 'utf8'));
  const rows = games.filter((r) => typeof u[r.id] === 'boolean');
  if (rows.length !== games.length) console.error(`fehlende Urteile: ${games.filter((r) => typeof u[r.id] !== 'boolean').map((r) => r.id).join(', ')}`);
  const k = cohenKappa(rows.map((r) => r.bewertung.passt), rows.map((r) => u[r.id]));
  const out = { n: k.n, kappa: Math.round(k.kappa * 1000) / 1000, uebereinstimmung: Math.round(k.agree * 1000) / 1000, tabelle: { auto_ja_bewerter_ja: k.table[1][1], auto_ja_bewerter_nein: k.table[1][0], auto_nein_bewerter_ja: k.table[0][1], auto_nein_bewerter_nein: k.table[0][0] },
    bewerterJa: rows.filter((r) => u[r.id]).length / rows.length, uneinig: rows.filter((r) => r.bewertung.passt !== u[r.id]).map((r) => ({ id: r.id, satz: r.satz, auto: r.bewertung.passt, bewerter: u[r.id] })) };
  console.log(JSON.stringify(out, null, 1));
  if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(out, null, 1) + '\n');
}
