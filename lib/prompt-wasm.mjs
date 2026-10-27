// Node-side loader for the vendored manifest-core wasm (static/vendor/manifest-core-wasm/).
// The browser loads the very same files; both sides therefore verify and render with identical code.
// `now` is Unix seconds as a number (the wasm takes a u64, i.e. a BigInt, which makeApi handles).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as bindings from '../static/vendor/manifest-core-wasm/manifest_core_wasm.js';
import { makeApi } from './prompt-core.mjs';

export const WASM_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'vendor', 'manifest-core-wasm');
export const nowSec = () => Math.floor(Date.now() / 1000);

let api = null;
/** Lazy init; returns { signPromptTemplate, verifyPromptTemplate, isPromptTemplateValid, renderPromptTemplate, verifyManifest }. */
export function wasm() {
  if (!api) {
    bindings.initSync({ module: readFileSync(join(WASM_DIR, 'manifest_core_wasm_bg.wasm')) });
    api = makeApi(bindings);
  }
  return api;
}
