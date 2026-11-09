#!/usr/bin/env node
// Copies the app's document rules (sanitizeDoc, docUrl and what they need) from CADS-agent-marketplace into lib/vendor/duell-web,
// so the server checks a card with exactly the code the app runs. PROVENANCE.json pins every file to its sha256 and the commit
// it came from; test/duell-karte.test.mjs refuses a copy that drifted, and compares it with the app's source when
// DUELL_WEB_SRC points at a checkout.
//
//   node bin/vendor-duell-web.mjs ~/claude-workspace/freie-karte/mp/apps/duell-web/src
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The files daily.js needs in Node (its require() closure). */
export const FILES = ['core.js', 'daily.js', 'duel.js', 'duel.json', 'engine.js', 'ideas.json', 'quest.js', 'quizpack.js', 'texts.json', 'turn.json', 'turns.js', 'turn-ui.js'];   // turn-ui.js: read as text only, for the limits of the date picker (lib/duell-karte.mjs CAP_LIMITS)
export const DIR = fileURLToPath(new URL('../lib/vendor/duell-web/', import.meta.url));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = resolve(process.argv[2] || '');
  const commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', src, 'status', '--porcelain', '--', ...FILES], { encoding: 'utf8' }).trim();
  if (dirty) { console.error('uncommitted changes in the app source:\n' + dirty); process.exit(1); }
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const files = {};
  for (const f of FILES) {
    copyFileSync(join(src, f), join(DIR, f));
    files[f] = { sha256: createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex') };
  }
  writeFileSync(join(DIR, 'PROVENANCE.json'), JSON.stringify({ repo: 'scimbe/CADS-agent-marketplace', path: 'apps/duell-web/src', commit, files }, null, 2) + '\n');
  console.log(`vendored ${readdirSync(DIR).length - 1} files from ${commit.slice(0, 12)}`);
}
