#!/usr/bin/env node
// Sign the prompt templates in templates/src/<slug>.json into templates/<slug>.json.
//
//   node bin/sign-templates.mjs --init-key      create the demo signing key if it does not exist
//   node bin/sign-templates.mjs                 sign every templates/src/*.json
//   node bin/sign-templates.mjs --only newsletter
//   node bin/sign-templates.mjs --verify        check the signatures of the shipped templates, no key needed
//
// Signing uses the vendored wasm (signPromptTemplate), the exact code the browser and the server
// verify with. The private key is a 32-byte ed25519 seed as 64 hex characters in a file OUTSIDE this
// repository (default ~/.config/cads/demo-template-signing.key, mode 600; override with --key FILE or
// CADS_TEMPLATE_SIGNING_KEY_FILE). It is never printed, logged or passed on a command line.
//
// A source component carries `from_manifest: "<slug>"` instead of digests. The script then takes
// sha256 and manifest_id from manifests/<slug>/manifest.json, refuses unless that manifest's
// signature verifies and bundle.tar.gz really hashes to bundle.sha256, and fills the usage-note
// placeholders {name} {version} {sha256_short} {provenance_note}. Digests are therefore never typed.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, chmodSync, openSync, writeSync, closeSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wasm } from '../lib/prompt-wasm.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'templates', 'src');
const OUT = join(ROOT, 'templates');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m) => { console.error('sign-templates: ' + m); process.exit(1); };
const keyFile = () => opt('--key') || process.env.CADS_TEMPLATE_SIGNING_KEY_FILE || join(homedir(), '.config', 'cads', 'demo-template-signing.key');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function readKey(path) {
  if (!existsSync(path)) die(`no signing key at ${path} (create one with --init-key)`);
  if (statSync(path).mode & 0o077) die(`${path} is readable by group/others; run: chmod 600 ${path}`);
  const hex = readFileSync(path, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) die(`${path} must hold 64 lowercase hex characters (a 32-byte ed25519 seed)`);
  return hex;
}

function initKey(path) {
  if (existsSync(path)) die(`${path} already exists; not overwriting`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'wx', 0o600);
  try { writeSync(fd, randomBytes(32).toString('hex') + '\n'); } finally { closeSync(fd); }
  chmodSync(path, 0o600);
  console.log(`created ${path} (mode 600). Sign once to learn the public key, then list it in templates/publishers.json.`);
}

function resolveComponent(c, w) {
  if (!c.from_manifest) return c;
  const slug = c.from_manifest;
  const dir = join(ROOT, 'manifests', slug);
  const manifestText = readFileSync(join(dir, 'manifest.json'), 'utf8');
  const m = JSON.parse(manifestText);
  if (!w.verifyManifest(manifestText)) die(`manifests/${slug}/manifest.json: signature does not verify; refusing to reference it`);
  const bundleSha = sha256(readFileSync(join(dir, 'bundle.tar.gz')));
  if (bundleSha !== m.bundle.sha256) die(`manifests/${slug}/bundle.tar.gz hashes to ${bundleSha}, manifest says ${m.bundle.sha256}`);
  let provenance;
  const dpPath = join(ROOT, `${slug}-dp-signed.json`);
  if (existsSync(dpPath)) {
    const dp = JSON.parse(readFileSync(dpPath, 'utf8'));
    if (!w.verifyManifest(readFileSync(dpPath, 'utf8'))) die(`${slug}-dp-signed.json: signature does not verify`);
    provenance = dp.bundle.sha256 === bundleSha
      ? `Dasselbe Bundle steht mit dieser Prüfsumme auch im Manifest des Marktplatz-Herausgebers (${slug}-dp-signed.json, Schlüssel ${dp.publisher_pubkey.slice(0, 8)}…).`
      : `Achtung: Das Manifest des Marktplatz-Herausgebers (${slug}-dp-signed.json) nennt ein anderes Bundle; hier steht die Prüfsumme des Bundles, das diese Demo tatsächlich installiert.`;
  } else provenance = 'Es gibt kein Manifest des Marktplatz-Herausgebers zum Vergleich.';
  const fill = { name: m.name, version: m.version, sha256_short: bundleSha.slice(0, 12), provenance_note: provenance };
  const usage = c.usage.replace(/\{(\w+)\}/g, (all, k) => (k in fill ? fill[k] : die(`unknown usage placeholder ${all}`)));
  return { name: c.name, sha256: bundleSha, manifest_id: m.manifest_id, usage };
}

const w = wasm();
const sources = readdirSync(SRC).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

if (flag('--init-key')) { initKey(keyFile()); process.exit(0); }

if (flag('--verify')) {
  let bad = 0;
  for (const slug of sources) {
    const text = readFileSync(join(OUT, `${slug}.json`), 'utf8');
    const ok = w.verifyPromptTemplate(text);
    console.log(`${ok ? 'ok     ' : 'BROKEN '} templates/${slug}.json  publisher ${JSON.parse(text).publisher_pubkey}`);
    if (!ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const only = opt('--only');
if (only && !sources.includes(only)) die(`no templates/src/${only}.json`);
const key = readKey(keyFile());
for (const slug of only ? [only] : sources) {
  const src = JSON.parse(readFileSync(join(SRC, `${slug}.json`), 'utf8'));
  src.components = src.components.map((c) => resolveComponent(c, w));
  let signed;
  try { signed = w.signPromptTemplate(key, JSON.stringify(src)); } catch (e) { die(`${slug}: ${e.message}`); }
  if (!w.verifyPromptTemplate(signed)) die(`${slug}: freshly signed template does not verify`);
  writeFileSync(join(OUT, `${slug}.json`), signed.endsWith('\n') ? signed : signed + '\n');
  console.log(`signed templates/${slug}.json  publisher ${JSON.parse(signed).publisher_pubkey}`);
}
