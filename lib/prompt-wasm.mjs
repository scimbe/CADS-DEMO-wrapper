// Node-side loader for the vendored manifest-core wasm (static/vendor/manifest-core-wasm/).
// The browser loads the very same files; both sides therefore verify and render with identical code.
// `now` is a Unix timestamp in seconds (the wasm takes a u64, i.e. a BigInt on the JS boundary).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as bindings from '../static/vendor/manifest-core-wasm/manifest_core_wasm.js';

export const WASM_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'vendor', 'manifest-core-wasm');

let ready = false;
function ensure() {
  if (ready) return;
  bindings.initSync({ module: readFileSync(join(WASM_DIR, 'manifest_core_wasm_bg.wasm')) });
  ready = true;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

/** Thin wrapper: lazy init, numbers for `now`, and plain Error messages. */
export function wasm() {
  ensure();
  return {
    signPromptTemplate: (keyHex, templateJson) => bindings.signPromptTemplate(keyHex, templateJson),
    verifyPromptTemplate: (json) => bindings.verifyPromptTemplate(json),
    isPromptTemplateValid: (json, now = nowSec()) => bindings.isPromptTemplateValid(json, BigInt(now)),
    renderPromptTemplate: (json, valuesJson, now = nowSec()) => JSON.parse(bindings.renderPromptTemplate(json, valuesJson, BigInt(now))),
    verifyManifest: (json) => bindings.verifyManifest(json),
  };
}
