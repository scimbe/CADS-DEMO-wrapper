// The provenance check, on the real wasm and in the real install path of the real server.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wasm, nowSec } from '../lib/prompt-wasm.mjs';
import { fetchRegistryManifest, judgeManifest, loadVerifiedManifest, readTrustRoot } from '../lib/manifest-trust.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const trusted = readTrustRoot(join(ROOT, 'manifests', 'publishers.json'));
const DEMOS = JSON.parse(readFileSync(join(ROOT, 'demos.json'), 'utf8'));
const raw = (slug) => readFileSync(join(ROOT, 'manifests', slug, 'manifest.json'), 'utf8');
const ctx = () => ({ api: wasm(), trusted, now: nowSec() });
const edit = (slug, fn) => { const m = JSON.parse(raw(slug)); fn(m); return JSON.stringify(m); };

test('every demo that installs a bundle has a trusted signature and the matching bundle', () => {
  const slugs = Object.values(DEMOS).filter((d) => d.manifestDir).map((d) => d.manifestDir.split('/').pop());
  assert.ok(slugs.length >= 6);
  for (const slug of slugs) {
    const j = judgeManifest(raw(slug), { ...ctx(), name: slug });
    assert.ok(j.ok, `${slug}: ${j.code}`);
    assert.equal(createHash('sha256').update(readFileSync(join(ROOT, 'manifests', slug, 'bundle.tar.gz'))).digest('hex'), j.manifest.bundle.sha256, slug);
  }
});

test('the trust root holds no demo key and no key from a manifest decides anything', () => {
  const templateKeys = JSON.parse(readFileSync(join(ROOT, 'templates', 'publishers.json'), 'utf8'));
  for (const [k, v] of Object.entries(templateKeys)) if (v.kind === 'demo') assert.ok(!Object.hasOwn(trusted, k));
  const seed = randomBytes(32).toString('hex');
  const m = JSON.parse(raw('newsletter'));
  const { publisher_pubkey, signature, ...unsigned } = m;
  const forged = wasm().signManifest(seed, JSON.stringify(unsigned));
  assert.equal(wasm().verifyManifest(forged), true, 'a correct signature by a foreign key');
  assert.equal(judgeManifest(forged, ctx()).code, 'untrusted-publisher');
});

test('tampering with any signed field is a bad signature; unsigned, expired, foreign demo are refused', () => {
  assert.equal(judgeManifest(edit('newsletter', (m) => { m.bundle.sha256 = '0'.repeat(64); }), ctx()).code, 'bad-signature');
  assert.equal(judgeManifest(edit('newsletter', (m) => { m.version = '9.9.9'; }), ctx()).code, 'bad-signature');
  assert.equal(judgeManifest(edit('newsletter', (m) => { m.bundle.compose_file = 'evil.sh'; }), ctx()).code, 'bad-signature');
  assert.equal(judgeManifest(edit('newsletter', (m) => { m.expires_at += 1; }), ctx()).code, 'bad-signature');
  assert.equal(judgeManifest(edit('newsletter', (m) => { m.signature = '0'.repeat(128); }), ctx()).code, 'bad-signature');
  assert.equal(judgeManifest(edit('newsletter', (m) => { delete m.signature; }), ctx()).code, 'unsigned');
  assert.equal(judgeManifest('not json', ctx()).code, 'invalid');
  assert.equal(judgeManifest(raw('newsletter'), { ...ctx(), now: JSON.parse(raw('newsletter')).expires_at }).code, 'expired');
  assert.equal(judgeManifest(raw('newsletter'), { ...ctx(), name: 'temporal-poc' }).code, 'wrong-manifest');
});

const answering = (status, body) => async () => new Response(body, { status });
const load = (slug, doFetch) => loadVerifiedManifest(raw(slug), { ...ctx(), name: slug, registryUrl: 'http://registry.invalid', doFetch });

test('registry: same manifest -> "registry"; unknown or down -> signed local copy, said so', async () => {
  assert.equal((await load('newsletter', answering(200, raw('newsletter')))).source, 'registry');
  assert.equal((await load('newsletter', answering(404, ''))).source, 'unpublished');
  assert.equal((await load('newsletter', answering(503, ''))).source, 'offline');
  assert.equal((await load('newsletter', async () => { throw new Error('down'); })).source, 'offline');
});

test('registry: an answer that is not exactly the pinned manifest refuses the install', async () => {
  assert.equal((await load('newsletter', answering(200, edit('newsletter', (m) => { m.bundle.sha256 = '0'.repeat(64); })))).code, 'bad-signature');
  assert.equal((await load('newsletter', answering(200, raw('temporal-poc')))).code, 'wrong-manifest');
  assert.equal((await load('newsletter', answering(200, 'garbage'))).code, 'invalid');
  const older = readFileSync(join(ROOT, 'phototools-dp-signed.json'), 'utf8'); // validly signed, but not the pinned one
  assert.equal((await load('phototools', answering(200, older))).code, 'registry-mismatch');
});

test('a malformed manifest id never reaches the network', async () => {
  let called = false;
  assert.equal((await fetchRegistryManifest('http://x', '../admin', { doFetch: async () => { called = true; } })).status, 'absent');
  assert.equal(called, false);
});

// ---- real server, real /api/start, real SSE log -----------------------------------------------
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
let dir, proc, base, registry, registryAnswer;

before(async () => {
  registry = http.createServer((req, res) => { const a = registryAnswer(req); res.writeHead(a[0]).end(a[1]); });
  await new Promise((r) => registry.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'manifest-trust-'));
  for (const e of readdirSync(ROOT)) if (!['server.mjs', 'manifests', 'work', '.git'].includes(e)) symlinkSync(join(ROOT, e), join(dir, e));
  cpSync(join(ROOT, 'server.mjs'), join(dir, 'server.mjs'));
  cpSync(join(ROOT, 'manifests'), join(dir, 'manifests'), { recursive: true });
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [join(dir, 'server.mjs')], { env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', REGISTRY_URL: `http://127.0.0.1:${registry.address().port}` }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { const to = setTimeout(() => reject(new Error('no start')), 8000); proc.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) { clearTimeout(to); resolve(); } }); });
});
after(() => { proc?.kill(); registry?.close(); rmSync(dir, { recursive: true, force: true }); });

// Read the SSE stream up to the end of the install step (the demo itself needs tools not present here).
async function installLog(slug) {
  const ctl = new AbortController();
  const r = await fetch(`${base}/api/start?demo=${slug}`, { signal: ctl.signal });
  let text = '';
  const dec = new TextDecoder();
  const stop = setTimeout(() => ctl.abort(), 6000);
  try { for await (const c of r.body) { text += dec.decode(c, { stream: true }); if (/installiert|Abbruch bei der Installation/.test(text)) break; } } catch {}
  clearTimeout(stop); ctl.abort();
  return text;
}
const runDirs = () => (existsSync(join(dir, 'work', 'runs')) ? readdirSync(join(dir, 'work', 'runs')) : []);
const SLUG = 'temporal-poc';
const inDir = (f) => join(dir, 'manifests', SLUG, f);

test('real path: an intact bundle installs, and the log says "echt geprüft", never "simuliert"', async () => {
  registryAnswer = () => [200, raw(SLUG)];
  const log = await installLog(SLUG);
  assert.match(log, /aus der Registry bezogen/);
  assert.match(log, /echt geprüft · ed25519-Signatur gültig · Marktplatz-Herausgeber \(1292c0cc/);
  assert.match(log, /echt · installiert/);
  assert.doesNotMatch(log, /simuliert/);
});

test('real path: a swapped bundle is refused and nothing is unpacked', async () => {
  registryAnswer = () => [404, ''];
  const before = runDirs().length;
  const good = readFileSync(inDir('bundle.tar.gz'));
  writeFileSync(inDir('bundle.tar.gz'), Buffer.concat([good, Buffer.from('tampered')]));
  try {
    const log = await installLog(SLUG);
    assert.match(log, /Installation abgelehnt · sha256 passt nicht/);
    assert.doesNotMatch(log, /echt · installiert/);
    assert.equal(runDirs().length, before);
  } finally { writeFileSync(inDir('bundle.tar.gz'), good); }
});

test('real path: a manifest edited to fit a swapped bundle is refused at the signature', async () => {
  registryAnswer = () => [404, ''];
  const good = readFileSync(inDir('manifest.json'), 'utf8');
  const m = JSON.parse(good); m.bundle.sha256 = '1'.repeat(64);
  writeFileSync(inDir('manifest.json'), JSON.stringify(m));
  try {
    const log = await installLog(SLUG);
    assert.match(log, /Installation abgelehnt · Signatur ungültig/);
    assert.doesNotMatch(log, /echt geprüft/);
  } finally { writeFileSync(inDir('manifest.json'), good); }
});

test('real path: a tampered registry answer is refused even though the local copy is fine', async () => {
  const m = JSON.parse(raw(SLUG)); m.verify.timeout_secs += 1;
  registryAnswer = () => [200, JSON.stringify(m)];
  const log = await installLog(SLUG);
  assert.match(log, /Installation abgelehnt · Signatur ungültig/);
  assert.doesNotMatch(log, /echt · installiert/);
});
