/* tslint:disable */
/* eslint-disable */

/**
 * Panics inside wasm otherwise surface only as an opaque "unreachable
 * executed" in the browser console -- this routes them through
 * `console.error` with the real Rust message/location instead. A no-op on
 * native targets.
 */
export function init_panic_hook(): void;

/**
 * Full validity check -- signature AND `now < expires_at`, via
 * [`ServiceManifest::is_valid`] directly. `now` is a caller-supplied Unix
 * timestamp (seconds) rather than read from the wall clock internally, so
 * this stays deterministic/testable and the caller decides its own time
 * source (`Math.floor(Date.now() / 1000)` in a browser).
 */
export function isManifestValid(manifest_json: string, now: bigint): boolean;

/**
 * Signature AND `now < expires_at` via [`PromptTemplate::is_valid`], `now` a caller-supplied Unix
 * timestamp (seconds) -- the [`is_manifest_valid`] analogue. ([`render_prompt_template`] enforces
 * the same check itself.)
 */
export function isPromptTemplateValid(template_json: string, now: bigint): boolean;

/**
 * Render a signed prompt template with the customer's values (a JSON object, parameter name ->
 * value, duplicate keys refused) via [`PromptTemplate::render_at`], so the signature AND
 * `now < expires_at` (caller-supplied Unix seconds) are enforced. Returns the [`manifest_core::RenderedPrompt`] as JSON
 * (`text`, `template_id`, `template_digest`, `values_digest`, `components`). Any refusal -- bad
 * signature, invalid structure, unknown/missing parameter, a value outside its signed bound -- is a
 * `JsError` whose message never contains the offending value. Free-text values come back wrapped
 * in `<customer-input>` blocks: data, not instructions.
 */
export function renderPromptTemplate(template_json: string, values_json: string, now: bigint): string;

/**
 * Sign an unsigned manifest (see [`UnsignedManifestInput`] for the accepted
 * JSON shape) with a publisher's ed25519 holder private key -- the SAME key
 * family/hex encoding `ct-agent-wasm`'s `generate_holder_identity`/`holderSign`
 * use, so a Keyforge holder identity signs a manifest with no key-format
 * translation. `publisher_pubkey` in the returned, signed manifest JSON is
 * always derived from `signing_key_hex` itself (via
 * [`ServiceManifest::sign_new`]) -- a caller cannot mint a manifest claiming a
 * key it does not hold.
 *
 * Returns the full, signed [`ServiceManifest`] as pretty-printed JSON
 * (`publisher_pubkey` and `signature` filled in).
 */
export function signManifest(signing_key_hex: string, manifest_json: string): string;

/**
 * Sign an unsigned prompt template (see [`UnsignedPromptTemplateInput`]) with a publisher's
 * ed25519 holder private key, same key encoding as [`sign_manifest`]. Refuses (`JsError`) a
 * template that fails [`PromptTemplate::validate_structure`]. Returns the signed template as
 * pretty-printed JSON.
 */
export function signPromptTemplate(signing_key_hex: string, template_json: string): string;

/**
 * Verify a signed manifest's signature ONLY -- recomputes
 * [`ServiceManifest::signing_bytes`] from the manifest's own fields and checks
 * the ed25519 signature against `publisher_pubkey`, ignoring `expires_at`.
 * Returns `Ok(false)` for a mismatched key, tampered field, or tampered
 * signature (a real answer to "is this authentic?"); `Err`/`JsError` is
 * reserved for malformed input (bad JSON, bad hex) -- "the caller couldn't
 * even ask the question," not "the answer is no."
 *
 * This checks authenticity only, never trust or currency -- see
 * [`is_manifest_valid`] for an expiry-aware check, and
 * [`ServiceManifest::is_valid`]'s own doc for why authenticity alone is never
 * sufficient grounds to install/run a manifest's bundle.
 */
export function verifyManifest(manifest_json: string): boolean;

/**
 * Verify a signed prompt template's signature ONLY, ignoring `expires_at` -- the
 * [`verify_manifest`] analogue. `Ok(false)` means tampered/forged; `Err` means malformed input.
 */
export function verifyPromptTemplate(template_json: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly isManifestValid: (a: number, b: number, c: bigint) => [number, number, number];
    readonly isPromptTemplateValid: (a: number, b: number, c: bigint) => [number, number, number];
    readonly renderPromptTemplate: (a: number, b: number, c: number, d: number, e: bigint) => [number, number, number, number];
    readonly signManifest: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly signPromptTemplate: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly verifyManifest: (a: number, b: number) => [number, number, number];
    readonly verifyPromptTemplate: (a: number, b: number) => [number, number, number];
    readonly init_panic_hook: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
