// Server-side prompt-template store: the authoritative place where a template is verified and a
// customer's values are rendered. Nothing here trusts text that came from the browser: the template
// is read from disk (TEMPLATES_DIR or ./templates), re-verified on every use, and rendered by the
// same wasm the browser uses.
//
//   templates/<slug>.json       signed PromptTemplate (bin/sign-templates.mjs)
//   templates/<slug>.meta.json  UI copy (DE/EN labels, defaults) and how a run uses the values; UNSIGNED
//   templates/publishers.json   trust list: publisher_pubkey -> label
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { wasm, nowSec } from './prompt-wasm.mjs';
import { inspectTemplate, validateValues, friendlyRenderError, formatDate } from './prompt-core.mjs';
import { makeT } from './i18n.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Largest request body /api/start accepts (values only; the template is never taken from the client). */
export const MAX_BODY_BYTES = 16 * 1024;

export function createTemplateStore(dir) {
  const path = (f) => join(dir, f);
  const readPublishers = () => { try { return readJson(path('publishers.json')); } catch { return {}; } };

  /** Load one slug fresh from disk and judge it. null when the demo has no template. */
  function get(slug, now = nowSec()) {
    if (!/^[a-z0-9-]+$/.test(slug) || !existsSync(path(`${slug}.meta.json`))) return null;
    let meta;
    try { meta = readJson(path(`${slug}.meta.json`)); } catch { return null; }
    let raw = null;
    try { raw = readFileSync(path(`${slug}.json`), 'utf8'); } catch { /* missing file -> invalid below */ }
    const publishers = readPublishers();
    const status = raw === null ? { ok: false, code: 'invalid' } : inspectTemplate(raw, { api: wasm(), publishers, now });
    return { slug, raw, meta, publishers, status, template: status.template || null };
  }

  const has = (slug) => /^[a-z0-9-]+$/.test(slug) && existsSync(path(`${slug}.meta.json`));
  return { dir, get, has, readPublishers };
}

const labelFor = (entry, lang) => (name) => (entry.meta.params[name] && entry.meta.params[name].label && (entry.meta.params[name].label[lang] || entry.meta.params[name].label.de)) || name;

const BLOCK_STATUS = { invalid: 422, unsigned: 422, 'bad-signature': 422, 'untrusted-publisher': 422, expired: 410 };

/**
 * Turn a customer's values into the prompt that will run.
 * Returns { ok:true, rendered, meta } or { ok:false, status, code, message, errors? } (message in `lang`).
 * `expect` ({template_digest?, values_digest?}) is what the customer's preview showed; a mismatch is refused.
 */
export function prepareRun(entry, values, { lang = 'de', now = nowSec(), expect = {} } = {}) {
  const t = makeT(lang);
  const fail = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });
  if (!entry) return fail(404, 'no-template', t('pb.srv.no-template'));
  if (!entry.status.ok) {
    const code = entry.status.code;
    const message = code === 'expired'
      ? t('pb.block.expired', { date: formatDate(entry.template.expires_at, lang) })
      : t('pb.block.' + code);
    return fail(BLOCK_STATUS[code] || 422, code, message);
  }
  if (!entry.meta.run || !entry.meta.run.mode) return fail(409, 'not-runnable', t('pb.srv.not-runnable'));
  const label = labelFor(entry, lang);
  const required = (n) => !!(entry.meta.params[n] && entry.meta.params[n].required);
  const check = validateValues(entry.template, values, { t, label, required });
  if (!check.ok) return fail(422, 'invalid-values', check.errors[0].message, { errors: check.errors });
  let rendered;
  try { rendered = wasm().renderPromptTemplate(entry.raw, JSON.stringify(values), now); }
  catch (e) {
    const f = friendlyRenderError(e && e.message, entry.template, { t, label });
    return fail(422, f.code, f.message, { errors: [f] });
  }
  if (expect.template_digest && expect.template_digest !== rendered.template_digest) return fail(409, 'digest-mismatch', t('pb.srv.digest-mismatch'));
  if (expect.values_digest && expect.values_digest !== rendered.values_digest) return fail(409, 'digest-mismatch', t('pb.srv.digest-mismatch'));
  return { ok: true, rendered, run: entry.meta.run };
}

/**
 * Map the validated values onto the existing run options (server-chosen keys only; the browser
 * cannot name them). run.cfg maps pipeline option -> template parameter.
 */
export function cfgFromValues(run, values) {
  const cfg = {};
  for (const [opt, param] of Object.entries(run.cfg || {})) if (param in values) cfg[opt] = values[param];
  return cfg;
}

/** The log line for a run: ids and digests only, never the customer's values. */
export const logLine = (slug, r) => JSON.stringify({ event: 'prompt-run', demo: slug, template_id: r.template_id, template_digest: r.template_digest, values_digest: r.values_digest });
