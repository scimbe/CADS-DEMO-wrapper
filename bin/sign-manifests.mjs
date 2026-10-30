#!/usr/bin/env node
// Sign the bundle manifests the gallery installs (manifests/<slug>/manifest.json).
//
//   node bin/sign-manifests.mjs --init-key            create the signing key if it does not exist
//   node bin/sign-manifests.mjs --public-key          print the PUBLIC key of the signing key
//   node bin/sign-manifests.mjs --only <slug> [--version x.y.z]    sign one bundle
//   node bin/sign-manifests.mjs --verify              check every manifest against manifests/publishers.json
//
// The private key is a 32-byte ed25519 seed as 64 hex characters in a file OUTSIDE this repository
// (default ~/.config/cads/gallery-manifest-publisher.key, mode 600; override with --key FILE or
// CADS_MANIFEST_SIGNING_KEY_FILE). It is never printed, logged or passed on a command line. Signing
// with the marketplace publisher's own key works the same way: point --key at it.
//
// sha256 is taken from the bundle on disk, never typed. Signing refuses if the result does not verify.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wasm, nowSec } from '../lib/prompt-wasm.mjs';
import { judgeManifest, readTrustRoot, REFUSAL } from '../lib/manifest-trust.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m) => { console.error('sign-manifests: ' + m); process.exit(1); };
const keyFile = () => opt('--key') || process.env.CADS_MANIFEST_SIGNING_KEY_FILE || join(homedir(), '.config', 'cads', 'gallery-manifest-publisher.key');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const YEAR = 365 * 24 * 3600;

function readKey(path) {
  if (!existsSync(path)) die(`no signing key at ${path} (create one with --init-key)`);
  if (statSync(path).mode & 0o077) die(`${path} is readable by group/others; run: chmod 600 ${path}`);
  const hex = readFileSync(path, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) die(`${path} must hold 64 lowercase hex characters (a 32-byte ed25519 seed)`);
  return hex;
}

// A throw-away manifest: signing it is the only way the wasm reveals the public key of a seed.
function publicKey(seedHex) {
  const probe = { manifest_id: '00'.repeat(32), name: 'probe', version: '0', installer_kind: 'binary', bundle: { url: 'x', sha256: '00'.repeat(32), compose_file: 'x' }, env_template: [], verify: { script: 'x', timeout_secs: 1 }, issued_at: 0, expires_at: 1 };
  return JSON.parse(wasm().signManifest(seedHex, JSON.stringify(probe))).publisher_pubkey;
}

if (flag('--init-key')) {
  const path = keyFile();
  if (existsSync(path)) die(`${path} already exists; not overwriting`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'wx', 0o600);
  try { writeSync(fd, randomBytes(32).toString('hex') + '\n'); } finally { closeSync(fd); }
  console.log(`created ${path} (mode 600). List its public key (--public-key) in manifests/publishers.json.`);
  process.exit(0);
}
if (flag('--public-key')) { console.log(publicKey(readKey(keyFile()))); process.exit(0); }

const slugs = readdirSync(join(ROOT, 'manifests'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

if (flag('--verify')) {
  const trusted = readTrustRoot(join(ROOT, 'manifests', 'publishers.json'));
  let bad = 0;
  for (const slug of slugs) {
    const dir = join(ROOT, 'manifests', slug);
    const j = judgeManifest(readFileSync(join(dir, 'manifest.json'), 'utf8'), { api: wasm(), trusted, now: nowSec(), name: slug });
    const sum = j.ok && sha256(readFileSync(join(dir, 'bundle.tar.gz'))) === j.manifest.bundle.sha256;
    console.log(`${sum ? 'ok     ' : 'BROKEN '} manifests/${slug}  ${j.ok ? (sum ? j.manifest.version + '  ' + j.manifest.publisher_pubkey.slice(0, 8) : 'bundle sha256 mismatch') : REFUSAL[j.code]}`);
    if (!sum) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const slug = opt('--only');
if (!slug || !slugs.includes(slug)) die('usage: --only <slug> [--version x.y.z] | --init-key | --public-key | --verify');
const dir = join(ROOT, 'manifests', slug);
const old = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const issued = nowSec();
const version = opt('--version') || old.version;
const sum = sha256(readFileSync(join(dir, 'bundle.tar.gz')));
const input = {
  manifest_id: sha256(`${slug}\n${version}\n${sum}\n${issued}`),
  name: slug, version, installer_kind: old.installer_kind,
  bundle: { ...old.bundle, sha256: sum },
  env_template: old.env_template, verify: old.verify,
  issued_at: issued, expires_at: issued + YEAR,
  ...(old.demo_prompt ? { demo_prompt: old.demo_prompt } : {}),
};
const key = readKey(keyFile());
let signed;
try { signed = wasm().signManifest(key, JSON.stringify(input)); } catch (e) { die(`${slug}: ${e.message}`); }
if (!wasm().verifyManifest(signed)) die(`${slug}: freshly signed manifest does not verify`);
const out = JSON.parse(signed);
if (old.source) out.source = old.source; // provenance of the bundle's source; not part of the signature
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`signed manifests/${slug}/manifest.json  ${version}  publisher ${out.publisher_pubkey}`);
