// lib/duell-llm.mjs: the month counter next to the day counter (W1a). No network: fetch is a stub that counts its calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLlm, monthFileOf } from '../lib/duell-llm.mjs';

const quiet = () => {};
const SYS = [{ text: 'RULES', cache: true }];
const answer = () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"x":"y"}' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 2000 } }) });
const counting = () => { const f = async () => { f.n++; return answer(); }; f.n = 0; return f; };
const NOV = Date.parse('2026-11-10T10:00:00Z');

test('default 10 USD a month; the month file sits next to the day file', () => {
  const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: counting(), log: quiet });
  assert.equal(llm.budget().month.limitUsd, 10);
  assert.equal(llm.budget().limitUsd, 5, 'the day limit stays 5 (comment fixed, code unchanged)');
  assert.equal(monthFileOf('/var/lib/duell-ai/card-budget.json'), '/var/lib/duell-ai/card-budget.month.json');
  assert.equal(monthFileOf(''), '');
});

test('a month sum over the limit blocks before the call, also on a fresh day', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-month-')), file = join(dir, 'b.json'), mfile = monthFileOf(file);
  writeFileSync(mfile, JSON.stringify({ month: '2026-11', usd: 9.9995, n: 400 }));
  const f = counting();
  const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_FILE: file }, fetchImpl: f, now: () => NOV, log: quiet });
  await assert.rejects(llm.generate({ system: SYS, user: 'u', maxTokens: 2000 }), (e) => e.code === 'budget-month');
  assert.equal(f.n, 0, 'no call went out');
  assert.equal(llm.budget().usd, 0, 'the day counter is untouched: a fresh day does not open the month');
  // the next month starts again at 0
  const dec = createLlm({ env: { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_FILE: file }, fetchImpl: f, now: () => Date.parse('2026-12-01T00:00:01Z'), log: quiet });
  assert.ok((await dec.generate({ system: SYS, user: 'u', maxTokens: 2000 })).json);
  assert.equal(f.n, 1);
  assert.equal(JSON.parse(readFileSync(mfile, 'utf8')).month, '2026-12');
});

test('the month sum is booked per call and survives a restart; the limit holds over several days', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-month-')), file = join(dir, 'b.json');
  let t = NOV;
  const f = counting();
  // 0.001 $ per answer (2000 output tokens at 0.50 $/M); day limit 0.0035 (3 calls a day), month limit 0.0045 (4 calls)
  const env = { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_FILE: file, DUELL_CARD_BUDGET_USD: '0.0035', DUELL_CARD_BUDGET_MONTH_USD: '0.0045' };
  const run = async () => { const llm = createLlm({ env, fetchImpl: f, now: () => t, log: quiet }); const out = []; for (let i = 0; i < 3; i++) out.push(await llm.generate({ system: SYS, user: 'u', maxTokens: 2000 }).then(() => 'ok', (e) => e.code)); return out; };
  assert.deepEqual(await run(), ['ok', 'ok', 'ok']);
  t += 86400000;
  assert.deepEqual(await run(), ['ok', 'budget-month', 'budget-month'], 'the day has room, the month does not: refused by the month counter');
  t += 86400000;
  assert.deepEqual(await run(), ['budget-month', 'budget-month', 'budget-month']);
  assert.equal(f.n, 4);
  const m = JSON.parse(readFileSync(monthFileOf(file), 'utf8'));
  assert.equal(m.n, 4);
  assert.ok(m.usd <= 0.0045);
});

test('fail closed: a month file that cannot be written gives 0 calls; an unreadable one too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-month-'));
  // a directory where the file should be: cannot be written (works as root too, unlike chmod)
  const blocked = join(dir, 'blocked.month.json');
  mkdirSync(blocked);
  const f = counting();
  const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_MONTH_FILE: blocked }, fetchImpl: f, log: quiet });
  for (let i = 0; i < 3; i++) await assert.rejects(llm.generate({ system: SYS, user: 'u' }), (e) => e.code === 'budget-month');
  assert.equal(f.n, 0, 'unwritable month file: 0 calls, not 1');
  assert.equal(llm.budget().month.broken, true);
  // a read-only directory (skipped when the test runs as root, which may write anyway)
  const ro = join(dir, 'ro');
  mkdirSync(ro); chmodSync(ro, 0o500);
  const roFile = join(ro, 'm.json');
  const llm2 = createLlm({ env: { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_MONTH_FILE: roFile }, fetchImpl: f, log: quiet });
  if (!existsSync(roFile)) { await assert.rejects(llm2.generate({ system: SYS, user: 'u' }), (e) => e.code === 'budget-month'); assert.equal(f.n, 0); }
  chmodSync(ro, 0o700);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{kaputt');
  const llm3 = createLlm({ env: { ANTHROPIC_API_KEY: 'k', DUELL_CARD_BUDGET_MONTH_FILE: bad }, fetchImpl: f, log: quiet });
  await assert.rejects(llm3.generate({ system: SYS, user: 'u' }), (e) => e.code === 'budget-month');
  assert.equal(f.n, 0);
  assert.equal(readFileSync(bad, 'utf8'), '{kaputt', 'a broken file is never overwritten');
});

test('a free local model is not held by the month counter (it costs nothing)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-month-')), blocked = join(dir, 'm.json');
  mkdirSync(blocked);
  const f = async () => ({ ok: true, status: 200, json: async () => ({ message: { content: '{"x":"y"}' }, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1, models: [{ name: 'qwen' }] }) });
  const llm = createLlm({ env: { DUELL_CARD_PROVIDER: 'ollama', DUELL_CARD_MODEL: 'qwen', DUELL_OLLAMA_BASE_URL: 'http://o', DUELL_OLLAMA_WINDOW: '0-0', DUELL_CARD_BUDGET_MONTH_FILE: blocked }, fetchImpl: f, log: quiet });
  // window "0-0" is never open: the refusal is 'busy', not 'budget-month'
  await assert.rejects(llm.generate({ system: SYS, user: 'u' }), (e) => e.code === 'busy');
});
