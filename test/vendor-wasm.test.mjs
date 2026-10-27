// The vendored wasm is a binary blob in git: pin it to PROVENANCE.json so it cannot drift silently,
// and prove it actually loads under Node (the server uses it for the authoritative render).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { WASM_DIR, wasm } from '../lib/prompt-wasm.mjs';

const PROV = JSON.parse(readFileSync(join(WASM_DIR, 'PROVENANCE.json'), 'utf8'));

test('PROVENANCE.json names the source repo, an exact commit and the toolchain', () => {
  assert.match(PROV.source.commit, /^[0-9a-f]{40}$/);
  assert.match(PROV.source.repo, /CADS-agent-marketplace/);
  assert.equal(PROV.source.dirty, false, 'never ship a build from a dirty checkout');
  assert.match(PROV.toolchain.rustc, /^rustc \d+\.\d+\.\d+/);
  assert.equal(PROV.toolchain.target, 'wasm32-unknown-unknown');
  assert.match(PROV.toolchain.wasm_bindgen_cli, /^\d+\.\d+\.\d+$/);
});

test('every vendored file matches its sha256 in PROVENANCE.json, and nothing else is in the directory', () => {
  for (const [name, meta] of Object.entries(PROV.files)) {
    const buf = readFileSync(join(WASM_DIR, name));
    assert.equal(createHash('sha256').update(buf).digest('hex'), meta.sha256, `${name}: sha256 differs from PROVENANCE.json (re-run bin/vendor-wasm.sh)`);
    assert.equal(buf.length, meta.bytes, `${name}: size`);
  }
  const onDisk = readdirSync(WASM_DIR).filter((n) => n !== 'PROVENANCE.json').sort();
  assert.deepEqual(onDisk, Object.keys(PROV.files).sort(), 'unlisted or missing vendored file');
});

test('the wasm loads under Node and exports the prompt-template API', () => {
  const w = wasm();
  for (const fn of ['signPromptTemplate', 'verifyPromptTemplate', 'isPromptTemplateValid', 'renderPromptTemplate']) assert.equal(typeof w[fn], 'function', fn);
  assert.throws(() => w.verifyPromptTemplate('{}'), /invalid prompt template JSON/, 'garbage in is an error, not a silent false');
});
