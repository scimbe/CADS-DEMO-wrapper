#!/usr/bin/env node
// Copies the game kit of the new app (Strang B: language mdi-bau/1, checker, interpreter, bots, playtest harness) from
// CADS-agent-marketplace apps/mdi/src into lib/vendor/mdi-baukasten, so the server checks and playtests a generated game with
// exactly the code the app plays it with (byte-equal, pinned). PROVENANCE.json holds the sha256 of every file and the commit;
// test/duell-bau.test.mjs refuses a drifted copy and compares with the app source when MDI_SRC points at a checkout.
//
//   node bin/vendor-mdi-baukasten.mjs <checkout>/apps/mdi/src
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Paths relative to apps/mdi/src; the directory layout is kept, so the relative imports stay valid. */
export const FILES = ['contract/sdk.js', 'engines/baukasten/spec.js', 'engines/baukasten/check.js', 'engines/baukasten/engine.js', 'engines/baukasten/zug.js',
  'engines/baukasten/bot.js', 'engines/baukasten/pruefer.js', 'engines/baukasten/beispiele.js', 'engines/baukasten/karte.js', 'engines/frei/seal.js'];   // karte.js braucht das Siegel (K #255)
export const DIR = fileURLToPath(new URL('../lib/vendor/mdi-baukasten/', import.meta.url));
export const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = resolve(process.argv[2] || '');
  const commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', src, 'status', '--porcelain', '--', ...FILES], { encoding: 'utf8' }).trim();
  if (dirty) { console.error('uncommitted changes in the app source:\n' + dirty); process.exit(1); }
  rmSync(DIR, { recursive: true, force: true });
  const files = {};
  for (const f of FILES) {
    mkdirSync(dirname(join(DIR, f)), { recursive: true });
    copyFileSync(join(src, f), join(DIR, f));
    files[f] = { sha256: sha(join(DIR, f)) };
  }
  // the app's files are ES modules with the extension .js; this directory says so to Node
  writeFileSync(join(DIR, 'package.json'), JSON.stringify({ type: 'module', private: true }, null, 2) + '\n');
  writeFileSync(join(DIR, 'PROVENANCE.json'), JSON.stringify({ repo: 'scimbe/CADS-agent-marketplace', path: 'apps/mdi/src', commit, files }, null, 2) + '\n');
  console.log(`vendored ${FILES.length} files from ${commit.slice(0, 12)}`);
}
