// lib/duell-llm.mjs: the three adapters, the cache breakpoint, the usage fields, the night window and the budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLlm, hitRate, inWindow, priceOf, readJson, usdOf } from '../lib/duell-llm.mjs';
import { makeLlm, systemContent, usageOf } from '../lib/duell.mjs';

const quiet = () => {};
const SYS = [{ text: 'RULES', cache: false }, { text: 'ENUMS', cache: false }, { text: 'EXAMPLES', cache: true }];
const SCHEMA = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'], additionalProperties: false };
const ok = (j) => ({ ok: true, status: 200, json: async () => j });

test('anthropic: /v1/messages, key only in the header, json_schema format, one 1h breakpoint on the last cached block, usage read', async () => {
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init }); return ok({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"x":"Hallo"}' }], stop_reason: 'end_turn', usage: { input_tokens: 40, output_tokens: 12, cache_read_input_tokens: 1800, cache_creation_input_tokens: 0 } }); };
  const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'sk-ant-TEST-123456' }, fetchImpl: f, log: quiet });
  assert.equal(llm.provider, 'anthropic'); assert.equal(llm.model, 'claude-haiku-5-5');
  const r = await llm.generate({ system: SYS, user: '<data>Frosch</data>', schema: SCHEMA, maxTokens: 300 });
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen[0].init.headers['x-api-key'], 'sk-ant-TEST-123456');
  assert.ok(seen[0].init.headers['anthropic-version']);
  const body = JSON.parse(seen[0].init.body);
  assert.ok(!seen[0].init.body.includes('sk-ant-TEST'));
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.deepEqual(body.output_config.format, { type: 'json_schema', schema: SCHEMA });
  assert.equal(body.temperature, undefined, 'Haiku 5.5 refuses sampling parameters');
  assert.deepEqual(body.system.map((b) => b.cache_control || null), [null, null, { type: 'ephemeral', ttl: '1h' }]);
  assert.deepEqual(body.messages, [{ role: 'user', content: '<data>Frosch</data>' }]);
  assert.deepEqual(r.json, { x: 'Hallo' });
  assert.deepEqual(r.usage, { in: 40, out: 12, cacheRead: 1800, cacheWrite: 0 });
  assert.ok(Math.abs(r.usd - (40 * 0.10 + 1800 * 0.01 + 12 * 0.50) / 1e6) < 1e-12);
});

test('anthropic: a refusal or a cut answer gives no json, but its tokens are booked', async () => {
  let stop = 'refusal';
  const f = async () => ok({ content: [{ type: 'text', text: '{"x":"y"}' }], stop_reason: stop, usage: { input_tokens: 100, output_tokens: 50 } });
  const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: f, log: quiet });
  assert.equal((await llm.generate({ system: SYS, user: 'u' })).json, null);
  stop = 'max_tokens';
  assert.equal((await llm.generate({ system: SYS, user: 'u' })).json, null);
  assert.equal(llm.stats().calls, 2);
  assert.ok(llm.budget().usd > 0);
});

test('provider switch by DUELL_CARD_PROVIDER / DUELL_CARD_MODEL; an unconfigured provider refuses without a call', async () => {
  let calls = 0;
  const f = async () => { calls++; return ok({}); };
  const none = createLlm({ env: {}, fetchImpl: f, log: quiet });
  assert.equal(none.configured, false);
  await assert.rejects(none.generate({ system: SYS, user: 'u' }), /not-configured/);
  const l = createLlm({ env: { DUELL_CARD_PROVIDER: 'litellm', DUELL_CARD_MODEL: 'anthropic/claude-haiku-5-5' }, llmEnv: { LITELLM_BASE_URL: 'http://l' }, fetchImpl: f, log: quiet });
  assert.equal(l.provider, 'litellm'); assert.equal(l.model, 'anthropic/claude-haiku-5-5');
  assert.equal(createLlm({ env: { DUELL_CARD_PROVIDER: 'gpt' }, log: quiet }).provider, 'anthropic', 'unknown provider -> default');
  assert.equal(calls, 0);
});

test('litellm: system blocks with cache_control, response_format json_schema, no chat_template_kwargs for Claude, cache usage read', async () => {
  let body;
  const f = async (url, init) => { body = JSON.parse(init.body); return ok({ choices: [{ message: { content: '{"x":"a"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1900, completion_tokens: 9, cache_read_input_tokens: 1800, cache_creation_input_tokens: 0 } }); };
  const llm = createLlm({ env: { DUELL_CARD_PROVIDER: 'litellm', DUELL_CARD_MODEL: 'claude-haiku-5-5' }, llmEnv: { LITELLM_BASE_URL: 'http://l/', LITELLM_API_KEY: 'k' }, fetchImpl: f, log: quiet });
  const r = await llm.generate({ system: SYS, user: 'u', schema: SCHEMA, name: 'card' });
  assert.equal(body.chat_template_kwargs, undefined);
  assert.equal(body.temperature, undefined);
  assert.equal(body.response_format.type, 'json_schema');
  assert.deepEqual(body.response_format.json_schema.schema, SCHEMA);
  assert.deepEqual(body.messages[0].content.map((b) => b.cache_control || null), [null, null, { type: 'ephemeral', ttl: '1h' }]);
  assert.deepEqual(r.usage, { in: 100, out: 9, cacheRead: 1800, cacheWrite: 0 });
  assert.deepEqual(r.json, { x: 'a' });
});

test('makeLlm: a local model keeps thinking off and its temperature; a string system stays a string', async () => {
  let body;
  const f = async (u, init) => { body = JSON.parse(init.body); return ok({ choices: [{ message: { content: 'x' } }] }); };
  await makeLlm({ baseUrl: 'http://l', model: 'local-qwen36-35b-a3b-coding', fetchImpl: f })('sys', 'u');
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.equal(body.temperature, 0.4);
  assert.equal(body.messages[0].content, 'sys');
  assert.deepEqual(systemContent([{ text: 'a', cache: true }, { text: 'b', cache: true }]).map((b) => !!b.cache_control), [false, true]);
  assert.equal(usageOf({ prompt_tokens: 10, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 6 } }).cacheRead, 6);
});

test('ollama and local litellm models: refused outside the night window and when the model is not loaded; never num_ctx or keep_alive', async () => {
  const day = Date.parse('2026-11-06T12:00:00Z'), night = Date.parse('2026-11-06T23:30:00Z');   // 13:00 and 00:30 in Berlin
  const seen = [];
  let loaded = ['qwen3.6:35b-a3b-coding'];
  const f = async (url, init = {}) => {
    seen.push({ url, body: init.body });
    if (url.endsWith('/api/ps')) return ok({ models: loaded.map((name) => ({ name, model: name })) });
    return ok({ message: { content: '{"x":"n"}' }, done_reason: 'stop', prompt_eval_count: 300, eval_count: 20 });
  };
  const env = { DUELL_CARD_PROVIDER: 'ollama', DUELL_CARD_MODEL: 'qwen3.6:35b-a3b-coding', DUELL_OLLAMA_BASE_URL: 'http://cs4f:11434', DUELL_OLLAMA_WINDOW: '22-6' };
  let t = day;
  const llm = createLlm({ env, fetchImpl: f, now: () => t, log: quiet });
  await assert.rejects(llm.generate({ system: SYS, user: 'u', schema: SCHEMA }), (e) => e.code === 'busy');
  assert.equal(seen.length, 0, 'by day not even the model list is asked');
  t = night;
  const r = await llm.generate({ system: SYS, user: 'u', schema: SCHEMA });
  assert.deepEqual(r.json, { x: 'n' });
  const chat = JSON.parse(seen.find((s) => s.url.endsWith('/api/chat')).body);
  assert.deepEqual(chat.format, SCHEMA);
  assert.equal(chat.stream, false);
  assert.equal(chat.keep_alive, undefined);
  assert.equal(chat.options.num_ctx, undefined);
  assert.ok(!seen.some((s) => /\/api\/(pull|delete|create|generate)/.test(s.url)));
  assert.equal(r.usd, 0);
  loaded = ['some-other:7b'];
  await assert.rejects(llm.generate({ system: SYS, user: 'u' }), (e) => e.code === 'busy');
  const viaProxy = createLlm({ env: { DUELL_CARD_PROVIDER: 'litellm', DUELL_CARD_MODEL: 'local-qwen36-35b-a3b-coding', DUELL_OLLAMA_WINDOW: '22-6' }, llmEnv: { LITELLM_BASE_URL: 'http://l' }, fetchImpl: f, now: () => day, log: quiet });
  await assert.rejects(viaProxy.generate({ system: SYS, user: 'u' }), (e) => e.code === 'busy');
  assert.equal(inWindow('', night), false, 'no window configured = never');
  assert.equal(inWindow('22-6', Date.parse('2026-11-06T05:30:00Z')), false, '06:30 Berlin is past the window');
  assert.equal(inWindow('22-6', Date.parse('2026-11-06T04:30:00Z')), true);
});

test('budget: the day sum in USD stops the calls and starts again the next UTC day; the budget file keeps it over a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-budget-'));
  const file = join(dir, 'b.json');
  let t = Date.parse('2026-11-06T10:00:00Z');
  const f = async () => ok({ content: [{ type: 'text', text: '{"x":"y"}' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  const env = { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_USD: '0.003', DUELL_CARD_BUDGET_FILE: file };
  const llm = createLlm({ env, fetchImpl: f, now: () => t, log: quiet });
  let n = 0;
  for (; n < 10; n++) { try { await llm.generate({ system: SYS, user: 'u', maxTokens: 2000 }); } catch (e) { assert.equal(e.code, 'budget'); break; } }
  assert.equal(n, 2, '2 x 0.001 $ fit, the third would pass 0.003 $ in the worst case');
  assert.ok(llm.budget().usd <= 0.003);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).day, '2026-11-06');
  const again = createLlm({ env, fetchImpl: f, now: () => t, log: quiet });
  await assert.rejects(again.generate({ system: SYS, user: 'u', maxTokens: 2000 }), (e) => e.code === 'budget');
  t += 86400000;
  assert.ok((await again.generate({ system: SYS, user: 'u', maxTokens: 2000 })).json);
  const off = createLlm({ env: { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_USD: '0' }, fetchImpl: f, log: quiet });
  await assert.rejects(off.generate({ system: SYS, user: 'u' }), (e) => e.code === 'budget');
});

test('prices, hit rate and the tolerant JSON reader', () => {
  assert.equal(priceOf('anthropic/claude-haiku-5-5').out, 0.50);
  assert.equal(priceOf('local-qwen36-35b-a3b-coding'), null);
  assert.equal(usdOf('local-x', { in: 1e6 }), 0);
  assert.equal(hitRate({ in: 10, cacheRead: 90, cacheWrite: 0 }), 0.9);
  assert.equal(hitRate({}), 0);
  assert.deepEqual(readJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(readJson('nope'), null);
});

test('the log has no prompt and no answer text', async () => {
  const lines = [];
  const f = async () => ok({ content: [{ type: 'text', text: '{"x":"GEHEIMER-TEXT"}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
  const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: f, log: (o) => lines.push(JSON.stringify(o)) });
  await llm.generate({ system: [{ text: 'SYSTEM-GEHEIM', cache: true }], user: 'NUTZER-GEHEIM' });
  assert.ok(lines.length);
  assert.ok(!lines.join('\n').match(/GEHEIM/));
});

test('budget holds under parallel calls: the worst case is reserved before the answer comes', async () => {
  let release;
  const gate = new Promise((ok) => { release = ok; });
  const f = async () => { await gate; return ok({ content: [{ type: 'text', text: '{"x":"y"}' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 2000 } }); };
  const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_USD: '0.0035' }, fetchImpl: f, log: quiet });
  const all = Array.from({ length: 10 }, () => llm.generate({ system: SYS, user: 'u', maxTokens: 2000 }).then(() => 'ok', (e) => e.code));
  release();
  const got = await Promise.all(all);
  assert.equal(got.filter((x) => x === 'ok').length, 3);
  assert.equal(got.filter((x) => x === 'budget').length, 7);
  assert.ok(llm.budget().usd <= 0.0035);
  assert.equal(llm.budget().heldUsd, 0);
});

test('a paid model without a price row is not configured; an alias gets its row by DUELL_CARD_PRICE_AS and no sampling parameters', async () => {
  let body;
  const f = async (u, init) => { body = JSON.parse(init.body); return ok({ choices: [{ message: { content: '{"x":"a"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }); };
  assert.equal(createLlm({ env: { ANTHROPIC_API_KEY: 'k', DUELL_CARD_MODEL: 'claude-sonnet-5-5' }, log: quiet }).configured, false);
  assert.equal(createLlm({ env: { DUELL_CARD_PROVIDER: 'litellm', DUELL_CARD_MODEL: 'haiku-cards' }, llmEnv: { LITELLM_BASE_URL: 'http://l' }, log: quiet }).configured, false);
  const alias = createLlm({ env: { DUELL_CARD_PROVIDER: 'litellm', DUELL_CARD_MODEL: 'haiku-cards', DUELL_CARD_PRICE_AS: 'claude-haiku-5-5' }, llmEnv: { LITELLM_BASE_URL: 'http://l' }, fetchImpl: f, log: quiet });
  assert.equal(alias.configured, true);
  const r = await alias.generate({ system: SYS, user: 'u' });
  assert.equal(body.temperature, undefined);
  assert.equal(body.chat_template_kwargs, undefined);
  assert.ok(r.usd > 0, 'priced by its row');
  assert.equal(inWindow('22-6', Date.now(), 'Mars/Olympus'), false, 'unknown time zone = closed, no throw');
});

test('a call that times out is booked at its worst case; an HTTP error is not', async () => {
  const slow = createLlm({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: (u, i) => new Promise((_, no) => i.signal.addEventListener('abort', () => no(new Error('aborted')))), log: quiet });
  await assert.rejects(slow.generate({ system: SYS, user: 'u', timeoutMs: 20 }), /aborted/);
  assert.ok(slow.budget().usd > 0);
  const bad = createLlm({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }), log: quiet });
  await assert.rejects(bad.generate({ system: SYS, user: 'u' }), /llm-http-400/);
  assert.equal(bad.budget().usd, 0);
});

test('budget fails closed: an unreadable budget file stops paid calls; default limit 5 USD a day', async () => {
  const { writeFileSync: wf } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'llm-broken-')), file = join(dir, 'b.json');
  wf(file, '{kaputt');
  const f = async () => ok({ content: [{ type: 'text', text: '{"x":"y"}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
  const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_FILE: file }, fetchImpl: f, log: quiet });
  await assert.rejects(llm.generate({ system: SYS, user: 'u' }), (e) => e.code === 'budget');
  assert.equal(createLlm({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: f, log: quiet }).budget().limitUsd, 5);
});
