#!/usr/bin/env node
// Static files of the /d/untertitel demo (static/vendor/untertitel/). Small ones are in git; the two
// big ones (speech model, ffmpeg core) are not: the Dockerfile fetches them with ADD --checksum and
// this script does the same for a local run.
//
//   node bin/vendor-untertitel.mjs           download what is missing, verify everything
//   node bin/vendor-untertitel.mjs --write   recompute PROVENANCE.json from the files on disk
//
// test/untertitel.test.mjs keeps PROVENANCE.json, the Dockerfile and the signed template in step.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'vendor', 'untertitel');
const PROV_PATH = join(DIR, 'PROVENANCE.json');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const prov = JSON.parse(readFileSync(PROV_PATH, 'utf8'));

function walk(dir) {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [relative(DIR, p)]; });
}

if (process.argv.includes('--write')) {
  for (const name of walk(DIR).filter((n) => n !== 'PROVENANCE.json').sort()) {
    const buf = readFileSync(join(DIR, name));
    prov.files[name] = { ...prov.files[name], sha256: sha256(buf), bytes: buf.length };
  }
  writeFileSync(PROV_PATH, JSON.stringify(prov, null, 2) + '\n');
  console.log('wrote PROVENANCE.json');
  process.exit(0);
}

let bad = 0;
for (const [name, meta] of Object.entries(prov.files)) {
  const path = join(DIR, name);
  if (!existsSync(path)) {
    if (!meta.url) { console.error(`missing: ${name}`); bad++; continue; }
    console.log(`fetch ${meta.url}`);
    const r = await fetch(meta.url);
    if (!r.ok) { console.error(`${name}: HTTP ${r.status}`); bad++; continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (sha256(buf) !== meta.sha256) { console.error(`${name}: sha256 mismatch, not saved`); bad++; continue; }
    writeFileSync(path, buf);
  }
  const ok = sha256(readFileSync(path)) === meta.sha256;
  console.log(`${ok ? 'ok     ' : 'BROKEN '} ${name}`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
