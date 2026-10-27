// Prompt-template logic shared by the server (Node) and the browser: this file has NO Node imports
// and is served to the page as /pb/prompt-core.mjs, so both sides judge a template identically.
//
//  - makeApi(bindings)         wraps the wasm exports (numbers for `now`, one calling convention)
//  - inspectTemplate(...)      signature + trusted publisher + expiry -> ok | a reason code
//  - validateValues(...)       friendly, plain-language checks that mirror the signed bounds
//  - friendlyRenderError(...)  turns the wasm's English error into a message for a person
//  - segmentRendered(...)      splits a rendered prompt so customer input can be shown marked
//
// The wasm (manifest-core, Rust) stays the authority: validateValues is only for good messages while
// typing. Whatever the wasm renders is what counts, and the server re-renders it itself.

/** Wrap the wasm-bindgen exports. `now` is Unix seconds as a number; the wasm wants a u64 (BigInt). */
export function makeApi(b) {
  return {
    signPromptTemplate: (keyHex, json) => b.signPromptTemplate(keyHex, json),
    verifyPromptTemplate: (json) => b.verifyPromptTemplate(json),
    isPromptTemplateValid: (json, now) => b.isPromptTemplateValid(json, BigInt(now)),
    renderPromptTemplate: (json, valuesJson, now) => JSON.parse(b.renderPromptTemplate(json, valuesJson, BigInt(now))),
    verifyManifest: (json) => b.verifyManifest(json),
  };
}

export const shortDigest = (hex, n = 12) => (typeof hex === 'string' && hex.length > n ? hex.slice(0, n) + '…' : String(hex ?? ''));

/** Calendar date in UTC so server, browser and tests agree. */
export function formatDate(ts, lang) {
  return new Date(Number(ts) * 1000).toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Judge a template as served. Order matters and is the same in the browser and on the server:
 * parseable -> has a signature -> signature verifies -> publisher is in OUR trust list -> not expired.
 * A valid signature alone only proves who signed, never that the signer is to be trusted.
 * Returns { ok:true, template, publisher } or { ok:false, code, template? } with code one of
 * invalid | unsigned | bad-signature | untrusted-publisher | expired | wasm-unavailable.
 */
export function inspectTemplate(raw, { api, publishers = {}, now }) {
  let template;
  try { template = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return { ok: false, code: 'invalid' }; }
  if (!template || typeof template !== 'object' || Array.isArray(template)) return { ok: false, code: 'invalid' };
  if (typeof template.signature !== 'string' || !template.signature) return { ok: false, code: 'unsigned', template };
  const json = JSON.stringify(template);
  if (!api) return { ok: false, code: 'wasm-unavailable', template };
  let sigOk;
  try { sigOk = api.verifyPromptTemplate(json); } catch { return { ok: false, code: 'invalid', template }; }
  if (!sigOk) return { ok: false, code: 'bad-signature', template };
  const publisher = publishers[template.publisher_pubkey];
  if (!publisher) return { ok: false, code: 'untrusted-publisher', template };
  let valid;
  try { valid = api.isPromptTemplateValid(json, now); } catch { return { ok: false, code: 'invalid', template }; }
  if (!valid) return { ok: false, code: 'expired', template };
  return { ok: true, template, publisher };
}

// ---- value checks -----------------------------------------------------------------------------

// Mirrors manifest-core's `is_forbidden_char`: control, format, private-use, unassigned, line and
// paragraph separators, plus invisible characters that sit in other categories.
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}︀-️\u{E0100}-\u{E01EF}\u{E0000}-\u{E007F}؜­͏᠎ㅤ]/u;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const count = (s) => [...s].length;
const lineCount = (s) => s.split('\n').length;

/** Size of a text value the way the wasm counts it (characters, lines). */
export function textStats(value) {
  const s = String(value ?? '').replace(/\r\n/g, '\n');
  return { chars: count(s), lines: s === '' ? 0 : lineCount(s) };
}

/** Plain defaults for a form: first option / minimum / empty text, overridden by `defaults` (UI-only). */
export function defaultValues(template, defaults = {}) {
  const out = {};
  for (const p of template.parameters) {
    if (p.name in defaults) { out[p.name] = defaults[p.name]; continue; }
    out[p.name] = p.type === 'enum' ? p.options[0] : p.type === 'multiselect' ? [] : p.type === 'int' ? p.min : p.type === 'color' ? '#1f4e79' : '';
  }
  return out;
}

/**
 * Check `values` against the template's signed bounds. ctx: { t, label(name), required(name)? }.
 * Returns { ok, errors: [{ param, code, message }] } in parameter order. Never includes the value.
 */
export function validateValues(template, values, ctx) {
  const { t, label, required = () => false } = ctx;
  const errors = [];
  const add = (param, code, vars = {}) => errors.push({ param, code, message: t('pb.err.' + code, { label: label(param), ...vars }) });
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, errors: [{ param: null, code: 'type', message: t('pb.err.generic') }] };
  for (const name of Object.keys(values)) if (!template.parameters.some((p) => p.name === name)) add(name, 'unknown');
  for (const p of template.parameters) {
    if (!(p.name in values)) { add(p.name, 'missing'); continue; }
    const v = values[p.name];
    switch (p.type) {
      case 'enum':
        if (typeof v !== 'string') add(p.name, 'type');
        else if (!p.options.includes(v)) add(p.name, 'notoption');
        break;
      case 'multiselect':
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) add(p.name, 'type');
        else if (new Set(v).size !== v.length) add(p.name, 'duplicate');
        else if (v.some((x) => !p.options.includes(x))) add(p.name, 'notoption');
        break;
      case 'int':
        if (typeof v !== 'number' || !Number.isInteger(v)) add(p.name, 'range', { min: p.min, max: p.max });
        else if (v < p.min || v > p.max) add(p.name, 'range', { min: p.min, max: p.max });
        break;
      case 'color':
        if (typeof v !== 'string') add(p.name, 'type');
        else if (!HEX_COLOR.test(v)) add(p.name, 'color');
        break;
      case 'text': {
        if (typeof v !== 'string') { add(p.name, 'type'); break; }
        const s = p.multiline ? v.replace(/\r\n/g, '\n') : v;
        if (required(p.name) && s.trim() === '') add(p.name, 'required');
        else if (count(s) > p.max_len) add(p.name, 'toolong', { max: p.max_len });
        else if (FORBIDDEN.test(p.multiline ? s.replace(/\n/g, '') : s)) add(p.name, 'forbidden');
        else if (p.max_lines != null && lineCount(s) > p.max_lines) add(p.name, 'toomanylines', { max: p.max_lines });
        break;
      }
      default: add(p.name, 'type');
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Map the wasm/Rust error text (English, developer-facing) to { code, param, message } for a person.
 * Unknown shapes fall back to a generic message; the raw text is never shown to the customer.
 */
export function friendlyRenderError(message, template, ctx) {
  const { t, label } = ctx;
  const msg = String(message ?? '');
  const mk = (code, param, vars) => ({ code, param: param ?? null, message: t(code.startsWith('block.') ? 'pb.' + code : 'pb.err.' + code, { label: param ? label(param) : '', ...vars }) });
  if (/signature does not verify/.test(msg)) return mk('block.bad-signature');
  if (/has expired/.test(msg)) return { code: 'block.expired', param: null, message: t('pb.block.expired.short') };
  let m = /^parameter '([^']+)': (.*)$/s.exec(msg);
  if (m) {
    const [, name, rest] = m;
    const p = template && template.parameters.find((x) => x.name === name);
    if (/longer than/.test(rest)) return mk('toolong', name, { max: p ? p.max_len : '' });
    if (/more than \d+ lines/.test(rest)) return mk('toomanylines', name, { max: p ? p.max_lines : '' });
    if (/control or invisible/.test(rest)) return mk('forbidden', name);
    if (/outside the range/.test(rest)) return mk('range', name, { min: p ? p.min : '', max: p ? p.max : '' });
    if (/not one of the declared options/.test(rest)) return mk('notoption', name);
    if (/duplicate selection/.test(rest)) return mk('duplicate', name);
    if (/#RRGGBB/.test(rest)) return mk('color', name);
    if (/^expected /.test(rest)) return mk('type', name);
  }
  m = /^missing parameter '([^']+)'/.exec(msg);
  if (m) return mk('missing', m[1]);
  m = /^unknown parameter '([^']+)'/.exec(msg);
  if (m) return mk('unknown', m[1]);
  if (/invalid prompt template/.test(msg)) return mk('block.invalid');
  return mk('generic');
}

/**
 * Split a rendered prompt into text / customer input / component parts so the UI can mark what
 * the customer typed. Component references are only recognised OUTSIDE customer-input blocks.
 */
export function segmentRendered(text, template) {
  const out = [];
  const names = (template.components || []).map((c) => c.name);
  const pushText = (s) => {
    if (!s) return;
    const re = /([A-Za-z0-9_-]{1,64})@sha256:([0-9a-f]{64})/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (!names.includes(m[1])) continue;
      if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) });
      out.push({ kind: 'component', name: m[1], digest: m[2], text: m[0] });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  };
  const re = /<customer-input name="([A-Za-z0-9_-]{1,64})">([\s\S]*?)<\/customer-input>/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    pushText(text.slice(last, m.index));
    out.push({ kind: 'input', name: m[1], text: m[2] });
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}
