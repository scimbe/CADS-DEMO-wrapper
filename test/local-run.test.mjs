// The command the page shows, run for real: the install script against a stand-in release server.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasLocalBlock, hasLocalRun, installScript, localRunBlock, localRunCommands, localRunConfig } from '../lib/local-run.mjs';
import { indexPage } from '../lib/index-page.mjs';

const TARGET = { 'Darwin-arm64': 'aarch64-apple-darwin', 'Darwin-x86_64': 'x86_64-apple-darwin', 'Linux-x86_64': 'x86_64-unknown-linux-musl', 'Linux-aarch64': 'aarch64-unknown-linux-musl' };
const target = TARGET[`${execFileSync('uname', ['-s']).toString().trim()}-${execFileSync('uname', ['-m']).toString().trim()}`];
const cfg = { version: 'cads-run-v0.1.0', base: 'https://gallery.test' };
let dir, server, sums, archive;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'local-run-'));
  mkdirSync(join(dir, 'pkg'));
  writeFileSync(join(dir, 'pkg', 'cads-run'), '#!/bin/sh\necho "stub ran: $*"\n');
  chmodSync(join(dir, 'pkg', 'cads-run'), 0o755);
  execFileSync('tar', ['-czf', join(dir, 'a.tgz'), '-C', join(dir, 'pkg'), 'cads-run']);
  archive = readFileSync(join(dir, 'a.tgz'));
  sums = `${createHash('sha256').update(archive).digest('hex')}  cads-run-${target}.tar.gz\n`;
  server = http.createServer((req, res) => {
    if (req.url.endsWith('/SHA256SUMS')) return res.end(sums);
    if (req.url.endsWith(`/cads-run-${target}.tar.gz`)) return res.end(archive);
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

// Async: this process also serves the stand-in release, a blocking spawn would starve it.
function runScript() {
  const home = mkdtempSync(join(dir, 'home-'));
  const script = join(dir, 'install.sh');
  writeFileSync(script, installScript(cfg));
  const c = spawn('sh', [script, 'contractcheck', '--allow-read', '/opt/x'], { env: { PATH: process.env.PATH, HOME: home, CADS_RUN_RELEASE_URL: `http://127.0.0.1:${server.address().port}/rel` } });
  let stdout = '', stderr = '';
  c.stdout.on('data', (d) => { stdout += d; });
  c.stderr.on('data', (d) => { stderr += d; });
  return new Promise((resolve) => c.on('close', (status) => resolve({ status, stdout, stderr, home })));
}

test('install script: right checksum installs and hands the arguments on', async () => {
  const r = await runScript();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /stub ran: contractcheck --allow-read \/opt\/x/);
});

test('install script: a wrong checksum stops before anything is installed or run', async () => {
  const keep = sums;
  sums = `${'0'.repeat(64)}  cads-run-${target}.tar.gz\n`;
  try {
    const r = await runScript();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Prüfsumme passt nicht/);
    assert.doesNotMatch(r.stdout, /stub ran/);
    assert.throws(() => readFileSync(join(r.home, '.cads-run', 'bin', 'cads-run')));
  } finally { sums = keep; }
});

test('without a published release nothing is offered, and the badge names only what runs in the browser', () => {
  assert.equal(localRunConfig({}).version, null);
  assert.equal(localRunConfig({ CADS_RUN_VERSION: 'v1; reboot' }).version, null, 'the version lands in a shell script');
  assert.equal(hasLocalRun('contractcheck', localRunConfig({})), false);
  assert.equal(hasLocalBlock('contractcheck', localRunConfig({})), false, 'no commands and no browser run: no block');
  const sec = indexPage({}, 'de').match(/<section class="trust"[\s\S]*?<\/section>/)[0];
  assert.match(sec, /Im Browser läuft schon etwas/);
  assert.match(sec, /Alles andere läuft hier auf unserem Server/);
  assert.doesNotMatch(sec, /Getestet auf macOS und Linux/, 'no command, so no tested-on claim');
});

test('with a release: active badge, commands for macOS and Linux, Windows said plainly as untested', () => {
  assert.equal(hasLocalRun('contractcheck', cfg), true);
  assert.equal(hasLocalRun('temporal-poc', cfg), false, 'needs a local server and network, cannot run sealed off');
  const sec = indexPage({}, 'de', { sandboxLive: true }).match(/<section class="trust"[\s\S]*?<\/section>/)[0];
  assert.match(sec, /Getestet auf macOS und Linux/);
  const c = localRunCommands('contractcheck', cfg);
  assert.match(c.macos, /brew install python poppler && curl -fsSL https:\/\/gallery\.test\/cads-run\.sh \| sh -s -- contractcheck --allow-read "\$\(brew --prefix\)"/);
  assert.match(c.linux, /bubblewrap python3 poppler-utils/);
  const block = localRunBlock('contractcheck', 'de', cfg);
  assert.match(block, /Nicht auf Windows getestet/);
  assert.match(block, /WSL2/);
  assert.match(block, /Noch nicht verfügbar/, 'no APK configured: the old text');
});

test('browser section: what really runs there is named, what does not says why, nothing is promised', () => {
  assert.equal(hasLocalBlock('untertitel', localRunConfig({})), true);
  assert.equal(hasLocalBlock('diagram', localRunConfig({})), true);
  const full = localRunBlock('untertitel', 'de', localRunConfig({}));
  assert.match(full, /<h3>Im Browser<\/h3>/);
  assert.match(full, /Läuft ganz in deinem Browser/);
  assert.doesNotMatch(full, /macOS|Linux|<pre/, 'no sandbox command without a release');
  const draw = localRunBlock('diagram', 'en', localRunConfig({}));
  assert.match(draw, /Drawing runs in your browser/);
  assert.match(draw, /only on our server/, 'the AI step is not claimed for the browser');
  const no = localRunBlock('phototools', 'de', cfg);
  assert.match(no, /Noch nicht: .*ExifTool und ImageMagick.*nicht gebaut/);
  assert.match(no, /<pre/, 'the command stays for phototools');
});

test('Android: APK link only with https URL and a valid checksum, otherwise the old text', () => {
  const sha = 'ab'.repeat(32);
  assert.equal(localRunConfig({}).android, null);
  assert.equal(localRunConfig({ CADS_ANDROID_APK_URL: 'https://x.test/a.apk' }).android, null, 'no checksum, no link');
  assert.equal(localRunConfig({ CADS_ANDROID_APK_SHA256: sha }).android, null, 'no URL, no link');
  assert.equal(localRunConfig({ CADS_ANDROID_APK_URL: 'http://x.test/a.apk', CADS_ANDROID_APK_SHA256: sha }).android, null, 'plain http is refused');
  assert.equal(localRunConfig({ CADS_ANDROID_APK_URL: 'javascript:alert(1)', CADS_ANDROID_APK_SHA256: sha }).android, null);
  assert.equal(localRunConfig({ CADS_ANDROID_APK_URL: 'https://x.test/a.apk', CADS_ANDROID_APK_SHA256: 'abc' }).android, null, 'checksum must be 64 hex');
  const on = { ...localRunConfig({ CADS_ANDROID_APK_URL: 'https://x.test/a.apk?x="y', CADS_ANDROID_APK_SHA256: sha.toUpperCase() }), version: cfg.version, base: cfg.base };
  for (const [lang, unknown, dl] of [['de', /unbekannten Quelle/, /APK herunterladen/], ['en', /unknown source/, /Download the APK/]]) {
    const b = localRunBlock('contractcheck', lang, on);
    assert.match(b, dl);
    assert.match(b, /href="https:\/\/x\.test\/a\.apk\?x=&quot;y"/, 'URL is escaped');
    assert.ok(b.includes(`<code>${sha}</code>`), 'checksum is shown (normalised to lower case)');
    assert.match(b, unknown);
    assert.doesNotMatch(b, /Noch nicht verfügbar|Not available yet/);
  }
});

// Windows: the script is meant to run in WSL2. WSL2 reports itself as Linux; this proves the script then
// picks the Linux build. It does NOT prove the sandbox (bubblewrap) works inside WSL2: that is untested.
test('install script: inside WSL2 (uname says Linux x86_64 with a Microsoft kernel) it takes the Linux build', async () => {
  const wsl = mkdtempSync(join(tmpdir(), 'wsl-'));
  const bin = join(wsl, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; -r) echo 5.15.153.1-microsoft-standard-WSL2;; *) echo Linux;; esac\n');
  chmodSync(join(bin, 'uname'), 0o755);
  const name = 'cads-run-x86_64-unknown-linux-musl.tar.gz';
  const asked = [];
  const srv = http.createServer((req, res) => {
    asked.push(req.url);
    if (req.url.endsWith('/SHA256SUMS')) return res.end(`${createHash('sha256').update(archive).digest('hex')}  ${name}\n`);
    if (req.url.endsWith(`/${name}`)) return res.end(archive);
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const script = join(wsl, 'install.sh');
  writeFileSync(script, installScript(cfg));
  const home = mkdtempSync(join(wsl, 'home-'));
  const c = spawn('sh', [script, 'contractcheck'], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, CADS_RUN_RELEASE_URL: `http://127.0.0.1:${srv.address().port}/rel` } });
  let out = '', err = '';
  c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
  const status = await new Promise((r) => c.on('close', r));
  srv.close(); rmSync(wsl, { recursive: true, force: true });
  assert.equal(status, 0, err);
  assert.ok(asked.some((u) => u.endsWith(`/${name}`)), `asked for ${asked.join(', ')}`);
  assert.match(out, /stub ran: contractcheck/);
});
