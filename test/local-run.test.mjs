// The command the page shows, run for real: the install script against a stand-in release server.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasLocalRun, installScript, localRunBlock, localRunCommands, localRunConfig } from '../lib/local-run.mjs';
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

test('without a published release nothing is offered and the badge stays honest', () => {
  assert.equal(localRunConfig({}).version, null);
  assert.equal(localRunConfig({ CADS_RUN_VERSION: 'v1; reboot' }).version, null, 'the version lands in a shell script');
  assert.equal(hasLocalRun('contractcheck', localRunConfig({})), false);
  const sec = indexPage({}, 'de').match(/<section class="trust"[\s\S]*?<\/section>/)[0];
  assert.match(sec, /In dieser Demo läuft alles auf unserem Server/);
});

test('with a release: active badge, commands for macOS and Linux, Windows and Android said plainly', () => {
  assert.equal(hasLocalRun('contractcheck', cfg), true);
  assert.equal(hasLocalRun('temporal-poc', cfg), false, 'needs a local server and network, cannot run sealed off');
  const sec = indexPage({}, 'de', { sandboxLive: true }).match(/<section class="trust"[\s\S]*?<\/section>/)[0];
  assert.match(sec, /Getestet auf macOS und Linux/);
  const c = localRunCommands('contractcheck', cfg);
  assert.match(c.macos, /brew install python poppler && curl -fsSL https:\/\/gallery\.test\/cads-run\.sh \| sh -s -- contractcheck --allow-read "\$\(brew --prefix\)"/);
  assert.match(c.linux, /bubblewrap python3 poppler-utils/);
  const block = localRunBlock('contractcheck', 'de', cfg);
  assert.match(block, /Noch nicht getestet/);
  assert.match(block, /Noch nicht verfügbar/);
});
