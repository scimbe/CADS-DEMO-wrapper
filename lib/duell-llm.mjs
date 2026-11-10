// My Daily Idea, "Create your own card": the one way to the model. Three adapters behind one call:
//
//   generate({ system: [{ text, cache }], user, schema, name, maxTokens, timeoutMs })
//     -> { json, raw, stop, usage: { in, out, cacheRead, cacheWrite }, usd, provider, model }
//
//   anthropic  POST /v1/messages, structured output (output_config.format json_schema), cache_control ttl 1h on the
//              last cached system block. https://platform.claude.com/docs/en/build-with-claude/structured-outputs and
//              https://platform.claude.com/docs/en/build-with-claude/prompt-caching
//   ollama     POST /api/chat, stream false, format = the schema. Only inside the night window and only with a model that is
//              already loaded (GET /api/ps): the GPU is shared with a call center, so this never pulls or deletes a model and
//              never sends num_ctx or keep_alive. https://docs.ollama.com/capabilities/structured-outputs
//   litellm    makeLlm (lib/duell.mjs) with system blocks and response_format; cache_control goes through to Anthropic.
//
// Chosen by DUELL_CARD_PROVIDER (anthropic | ollama | litellm) and DUELL_CARD_MODEL; the default is Claude Haiku 5.5.
// Prefix rule for the cache: the system blocks are fixed text (no date, id, seed, credit or language); everything that varies
// goes into `user`. The schema is part of the cached prefix too (a changed format invalidates it), so each call site keeps one.
//
// Budget: every answer is priced from its usage (PRICES, USD per million tokens) and summed per UTC day. When the day's sum
// reaches DUELL_CARD_BUDGET_USD the layer refuses with 'budget' until the next day; a refusal by the model is priced too.
// A second, separate counter sums per UTC month (DUELL_CARD_BUDGET_MONTH_USD, default 10, file DUELL_CARD_BUDGET_MONTH_FILE or
// "<budget file>.month.json"); at its limit the layer refuses with 'budget-month' until the next month.
// Nothing here logs a prompt or an answer: the log has provider, model, outcome, tokens and dollars only.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { makeLlm } from './duell.mjs';

export const PROVIDERS = ['anthropic', 'ollama', 'litellm'];
export const DEFAULT_MODEL = 'claude-haiku-5-5';
/** USD per million tokens (https://platform.claude.com/docs/en/about-claude/pricing, prompts up to 100k tokens). */
export const PRICES = {
  'claude-haiku-5-5': { in: 0.10, write1h: 0.20, read: 0.01, out: 0.50 },
  'claude-haiku-4-5': { in: 1.00, write1h: 2.00, read: 0.10, out: 5.00 },
};
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };

/** The price row of a model name; a LiteLLM alias like "anthropic/claude-haiku-5-5" finds its row too. Unknown -> null. */
export function priceOf(model) {
  const m = String(model || '').toLowerCase();
  if (!m) return null;
  const k = Object.keys(PRICES).find((p) => m.includes(p));
  return k ? PRICES[k] : null;
}
/** Dollars of one answer. A local model (no price row) costs 0. */
export function usdOf(model, u) {
  const p = priceOf(model);
  if (!p || !u) return 0;
  return ((u.in || 0) * p.in + (u.cacheWrite || 0) * p.write1h + (u.cacheRead || 0) * p.read + (u.out || 0) * p.out) / 1e6;
}
/** Share of the input that came from the cache: cacheRead / (in + cacheRead + cacheWrite). */
export function hitRate(u) {
  const all = (u.in || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
  return all ? (u.cacheRead || 0) / all : 0;
}

/**
 * Is `t` inside the window "HH-HH" (start inclusive, end exclusive, may wrap midnight) in the time zone tz?
 * An empty or malformed spec is never open: the GPU is only ours when the operator has said when.
 */
export function inWindow(spec, t, tz = 'Europe/Berlin') {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(spec || '').trim());
  if (!m) return false;
  const a = Number(m[1]) % 24, b = Number(m[2]) % 24;
  if (a === b) return false;
  let h;
  try { h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(t))); } catch { return false; }   // unknown zone: closed
  return a < b ? h >= a && h < b : h >= a || h < b;
}

/** A local model (our GPU) behind LiteLLM is "local-..."; it falls under the same night window as the ollama adapter. */
const isLocal = (model) => /^local-/.test(String(model || ''));

/** The JSON of an answer text; a fenced or chatty answer of a local model is tolerated, anything else is null. */
export function readJson(raw) {
  const s = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// Fail closed: a budget file that is there but cannot be read, or that cannot be written, stops the paid calls (broken),
// since the day's sum would otherwise be unknown.
function budgetStore(file, log) {
  let state = { day: '', usd: 0, n: 0 }, broken = false;
  if (file) {
    try { if (existsSync(file)) { const j = JSON.parse(readFileSync(file, 'utf8')); if (j && typeof j.day === 'string' && Number.isFinite(j.usd)) state = { day: j.day, usd: Math.max(0, j.usd), n: num(j.n, 0) }; else throw new Error('shape'); } }
    catch { broken = true; log({ event: 'duell-llm-budget', ok: false, why: 'unreadable' }); }
  }
  const save = () => {
    if (!file) return;
    try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify(state)); renameSync(file + '.tmp', file); }
    catch { broken = true; log({ event: 'duell-llm-budget', ok: false, why: 'unwritable' }); }
  };
  return { get: () => state, set: (s) => { state = s; save(); }, broken: () => broken };
}

// The month's sum, its own structure next to the day's. Fail closed like budgetStore, and stricter: the file is written once
// when the layer starts, so a month file that cannot be written stops the paid calls before the first one, not after it.
function monthStore(file, log) {
  let state = { month: '', usd: 0, n: 0 }, broken = false;
  const save = () => {
    if (!file) return;
    try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify(state)); renameSync(file + '.tmp', file); }
    catch { broken = true; log({ event: 'duell-llm-budget-month', ok: false, why: 'unwritable' }); }
  };
  if (file) {
    try { if (existsSync(file)) { const j = JSON.parse(readFileSync(file, 'utf8')); if (j && typeof j.month === 'string' && Number.isFinite(j.usd)) state = { month: j.month, usd: Math.max(0, j.usd), n: num(j.n, 0) }; else throw new Error('shape'); } }
    catch { broken = true; log({ event: 'duell-llm-budget-month', ok: false, why: 'unreadable' }); }
    if (!broken) save();
  }
  return { get: () => state, set: (s) => { state = s; save(); }, broken: () => broken };
}
/** The month file of a day budget file: card-budget.json -> card-budget.month.json */
export const monthFileOf = (file) => (file ? String(file).replace(/(\.json)?$/, '.month.json') : '');

/**
 * The layer. env: DUELL_CARD_PROVIDER, DUELL_CARD_MODEL, DUELL_CARD_BUDGET_USD (default 5), DUELL_CARD_BUDGET_FILE,
 * DUELL_CARD_BUDGET_MONTH_USD (default 10),
 * DUELL_CARD_BUDGET_MONTH_FILE (default: the budget file's .month.json), ANTHROPIC_API_KEY or DUELL_ANTHROPIC_KEY_FILE, DUELL_ANTHROPIC_BASE_URL, DUELL_OLLAMA_BASE_URL, DUELL_OLLAMA_WINDOW ("22-6"),
 * DUELL_OLLAMA_TZ, DUELL_CARD_EFFORT (anthropic, default low), DUELL_CARD_PRICE_AS (the PRICES row of a LiteLLM alias whose
 * name does not say which Claude it is). llmEnv: LITELLM_BASE_URL, LITELLM_API_KEY.
 * A paid model needs a price row: an anthropic or non-local LiteLLM model without one is not configured (it would cost
 * money the budget cannot see). Only ollama and local-* models are free.
 */
export function createLlm({ env = process.env, llmEnv = {}, fetchImpl = fetch, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)) } = {}) {
  const provider = PROVIDERS.includes(String(env.DUELL_CARD_PROVIDER || '').trim()) ? String(env.DUELL_CARD_PROVIDER).trim() : 'anthropic';
  const model = String(env.DUELL_CARD_MODEL || '').trim() || DEFAULT_MODEL;
  const budgetUsd = num(env.DUELL_CARD_BUDGET_USD, 5);
  const window = String(env.DUELL_OLLAMA_WINDOW || '');
  const tz = String(env.DUELL_OLLAMA_TZ || 'Europe/Berlin');
  const effort = ['low', 'medium', 'high'].includes(env.DUELL_CARD_EFFORT) ? env.DUELL_CARD_EFFORT : 'low';
  let anthropicKey = String(env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey && env.DUELL_ANTHROPIC_KEY_FILE) { try { anthropicKey = readFileSync(env.DUELL_ANTHROPIC_KEY_FILE, 'utf8').trim(); } catch { log({ event: 'duell-llm-config', note: 'DUELL_ANTHROPIC_KEY_FILE unreadable' }); } }
  const anthropicBase = String(env.DUELL_ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const version = env.DUELL_ANTHROPIC_VERSION || '2026-10-21';
  const ollamaBase = String(env.DUELL_OLLAMA_BASE_URL || '').replace(/\/$/, '');
  const budget = budgetStore(env.DUELL_CARD_BUDGET_FILE || '', log);
  const monthUsd = num(env.DUELL_CARD_BUDGET_MONTH_USD, 10);
  const monthBudget = monthStore(env.DUELL_CARD_BUDGET_MONTH_FILE || monthFileOf(env.DUELL_CARD_BUDGET_FILE), log);
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const month = () => new Date(now()).toISOString().slice(0, 7);
  const totals = { calls: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, usd: 0, refused: {} };
  const litellm = makeLlm({ baseUrl: llmEnv.LITELLM_BASE_URL, apiKey: llmEnv.LITELLM_API_KEY, model, timeoutMs: 30000, maxTokens: 4096, detail: true, fetchImpl });

  const free = provider === 'ollama' || (provider === 'litellm' && isLocal(model));
  const priced = priceOf(model) || priceOf(env.DUELL_CARD_PRICE_AS);
  const priceName = priceOf(model) ? model : String(env.DUELL_CARD_PRICE_AS || '');
  const configured = (provider === 'anthropic' ? !!anthropicKey : provider === 'ollama' ? !!ollamaBase : !!llmEnv.LITELLM_BASE_URL) && (free || !!priced);
  if (!configured) log({ event: 'duell-llm-config', note: `provider ${provider} is not configured${free || priced ? '' : ' (no price for this model, see DUELL_CARD_PRICE_AS)'}: the card kind answers 503` });
  const usdFor = (u) => (free ? 0 : usdOf(priceName, u));
  let held = 0;   // the worst case of the calls on their way: booked before the answer, so parallel calls cannot pass the limit

  function spent() { const s = budget.get(); return s.day === day() ? s : { day: day(), usd: 0, n: 0 }; }
  function spentMonth() { const s = monthBudget.get(); return s.month === month() ? s : { month: month(), usd: 0, n: 0 }; }
  function book(usd) {
    const s = spent(); budget.set({ day: s.day, usd: s.usd + usd, n: s.n + 1 });
    const m = spentMonth(); monthBudget.set({ month: m.month, usd: m.usd + usd, n: m.n + 1 });
  }
  const refuse = (why) => { totals.refused[why] = (totals.refused[why] || 0) + 1; const e = new Error(why); e.code = why; throw e; };

  /** Is the GPU ours right now, and is the model already loaded? Never loads one. */
  async function localReady(base, name, signal) {
    if (!inWindow(window, now(), tz)) return false;
    if (!base) return true;   // litellm: the proxy owns the model list; the window is the rule
    try {
      const r = await fetchImpl(base + '/api/ps', { method: 'GET', signal });
      if (!r.ok) return false;
      const j = await r.json();
      return Array.isArray(j.models) && j.models.some((m) => m && (m.name === name || m.model === name));
    } catch { return false; }
  }

  async function anthropic(req, signal) {
    const last = req.system.map((b) => b.cache).lastIndexOf(true);
    const body = {
      model, max_tokens: req.maxTokens,
      system: req.system.map((b, i) => ({ type: 'text', text: b.text, ...(i === last ? { cache_control: { type: 'ephemeral', ttl: '1h' } } : {}) })),
      messages: [{ role: 'user', content: req.user }],
      output_config: { effort, ...(req.schema ? { format: { type: 'json_schema', schema: req.schema } } : {}) },
    };
    const r = await fetchImpl(anthropicBase + '/v1/messages', {
      method: 'POST', signal,
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': version, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('llm-http-' + r.status);
    const j = await r.json();
    // read the answer by block type: Haiku 5.5 may put thinking blocks first
    const raw = (Array.isArray(j.content) ? j.content : []).filter((c) => c && c.type === 'text').map((c) => c.text).join('');
    const u = j.usage || {};
    return { raw, stop: j.stop_reason || '', usage: { in: num(u.input_tokens, 0), out: num(u.output_tokens, 0), cacheRead: num(u.cache_read_input_tokens, 0), cacheWrite: num(u.cache_creation_input_tokens, 0) } };
  }
  async function ollama(req, signal) {
    if (!(await localReady(ollamaBase, model, signal))) refuse('busy');
    // the schema goes into format and, as Ollama recommends, into the prompt too; no num_ctx, no keep_alive (the server's own)
    const r = await fetchImpl(ollamaBase + '/api/chat', {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, format: req.schema || 'json', options: { temperature: 0, num_predict: req.maxTokens },
        messages: [{ role: 'system', content: req.system.map((b) => b.text).join('\n\n') + (req.schema ? `\nAnswer as JSON matching this schema: ${JSON.stringify(req.schema)}` : '') }, { role: 'user', content: req.user }],
      }),
    });
    if (!r.ok) throw new Error('llm-http-' + r.status);
    const j = await r.json();
    return { raw: (j.message && j.message.content) || '', stop: j.done_reason === 'length' ? 'max_tokens' : j.done_reason || '', usage: { in: num(j.prompt_eval_count, 0), out: num(j.eval_count, 0), cacheRead: 0, cacheWrite: 0 } };
  }
  async function viaLitellm(req) {
    if (isLocal(model) && !(await localReady('', model))) refuse('busy');
    // a Claude model (priced) gets no sampling parameter and no chat_template_kwargs, whatever its alias is called
    const r = await litellm(req.system, req.user, { maxTokens: req.maxTokens, timeoutMs: req.timeoutMs, schema: req.schema, schemaName: req.name, claude: !free, ...(free ? { temperature: 0 } : {}) });
    const u = r.usage || {};
    return { raw: r.text, stop: r.stop === 'length' ? 'max_tokens' : r.stop === 'content_filter' ? 'refusal' : r.stop, usage: { in: u.in || 0, out: u.out || 0, cacheRead: u.cacheRead || 0, cacheWrite: u.cacheWrite || 0 } };
  }

  async function generate(input) {
    const req = {
      system: (Array.isArray(input.system) ? input.system : [{ text: String(input.system || ''), cache: true }]).map((b) => ({ text: String((b && b.text) || ''), cache: !!(b && b.cache) })),
      user: String(input.user || ''), schema: input.schema || null, name: input.name || 'answer',
      maxTokens: Math.max(16, Math.min(4096, Math.round(num(input.maxTokens, 800)))), timeoutMs: num(input.timeoutMs, 0) || 30000,
    };
    if (!configured) refuse('not-configured');
    // the budget holds back the worst case of this call (whole prompt written to the cache, full output) until the answer is
    // there, so the day's sum never passes the limit, also with calls running at the same time
    const worst = usdFor({ cacheWrite: Math.ceil(JSON.stringify(req).length / 3), out: req.maxTokens });
    if (budgetUsd <= 0 || (!free && budget.broken()) || spent().usd + held + worst > budgetUsd) refuse('budget');
    if (!free && (monthUsd <= 0 || monthBudget.broken() || spentMonth().usd + held + worst > monthUsd)) refuse('budget-month');
    held += worst;
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), req.timeoutMs);
    const started = now();
    let r;
    try { r = provider === 'anthropic' ? await anthropic(req, ctl.signal) : provider === 'ollama' ? await ollama(req, ctl.signal) : await viaLitellm(req); }
    catch (e) {
      // an answer we never read (timeout, broken connection) may still be billed: booked at its worst case. An HTTP error
      // status is not billed, a refusal by this layer ('busy') sent nothing.
      if (!e.code && !/^llm-http-/.test(e.message)) book(worst);
      throw e;
    }
    finally { clearTimeout(to); held -= worst; }
    const usd = usdFor(r.usage);
    book(usd);
    totals.calls++; for (const k of ['in', 'out', 'cacheRead', 'cacheWrite']) totals[k] += r.usage[k]; totals.usd += usd;
    // a refusal or a cut answer is no card: json stays null, the tokens are booked all the same
    const json = r.stop === 'refusal' || r.stop === 'max_tokens' ? null : readJson(r.raw);
    log({ event: 'duell-llm', provider, model, stop: r.stop, ok: !!json, ms: now() - started, ...r.usage, usd: Math.round(usd * 1e6) / 1e6 });
    return { json, raw: r.raw, stop: r.stop, usage: r.usage, usd, provider, model };
  }

  /** Token count of a request (anthropic only): checks that a prefix reaches the cache minimum (512 tokens on Haiku 5.5). */
  async function countTokens(input) {
    if (provider !== 'anthropic' || !anthropicKey) return null;
    const sys = (Array.isArray(input.system) ? input.system : [{ text: String(input.system || '') }]).map((b) => ({ type: 'text', text: String(b.text || '') }));
    const r = await fetchImpl(anthropicBase + '/v1/messages/count_tokens', {
      method: 'POST', headers: { 'x-api-key': anthropicKey, 'anthropic-version': version, 'content-type': 'application/json' },
      body: JSON.stringify({ model, system: sys, messages: [{ role: 'user', content: String(input.user || 'x') }], ...(input.schema ? { output_config: { format: { type: 'json_schema', schema: input.schema } } } : {}) }),
    });
    if (!r.ok) throw new Error('llm-http-' + r.status);
    return num((await r.json()).input_tokens, 0);
  }

  return {
    provider, model, configured, generate, countTokens,
    budget: () => ({ limitUsd: budgetUsd, ...spent(), heldUsd: held, month: { limitUsd: monthUsd, ...spentMonth(), broken: monthBudget.broken() } }),
    stats: () => ({ provider, model, ...totals, refused: { ...totals.refused }, hitRate: hitRate(totals) }),
  };
}
