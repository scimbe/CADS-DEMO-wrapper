// Harness swarm (eval of the free card): the one way to the Anthropic API for personas and judges, and the cost ledger
// that every call of the run books into, the system under test included (lib/duell-llm.mjs through fetchImpl and onUsd).
//
// Hard cap: the ledger refuses a call when spent + held + the call's worst case would pass capUsd. Held is the worst case
// of the calls on their way (as in lib/duell-llm.mjs), so parallel calls cannot pass the cap. A call whose answer was never
// read (timeout, broken connection) is booked at its worst case. The ledger file survives restarts of the run.
// The key is read at runtime from a dotenv file (keyFrom) and only ever goes into the x-api-key header; nothing here logs
// a prompt, an answer or the key.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** USD per million tokens (platform.claude.com pricing, cached 2026-10-06; prompts up to 100k tokens). write = 1h cache write */
export const PRICES = {
  'claude-haiku-5-5': { in: 0.10, write: 0.20, read: 0.01, out: 0.50 },
  'claude-sonnet-5-5': { in: 2.00, write: 4.00, read: 0.20, out: 10.00 },
  'claude-opus-5-5': { in: 4.00, write: 8.00, read: 0.20, out: 20.00 },
};
export const usdOf = (model, u) => {
  const p = PRICES[model];
  if (!p) throw new Error('no price for ' + model);
  return ((u.in || 0) * p.in + (u.cacheWrite || 0) * p.write + (u.cacheRead || 0) * p.read + (u.out || 0) * p.out) / 1e6;
};

/** The value of one variable of a dotenv file (KEY=value, optional quotes, # comments). Never printed by this module. */
export function envValue(text, name) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || m[1] !== name) continue;
    let v = m[2].trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '');
    return v.trim();
  }
  return '';
}
export function keyFrom(file, name = 'ANTHROPIC_API_KEY') {
  const v = envValue(readFileSync(file, 'utf8'), name);
  if (!v) throw new Error('key variable missing in env file');
  return v;
}

/**
 * The cost ledger: { usd, calls, byRole: { role: { usd, calls, in, out, cacheRead, cacheWrite } } }. Every booking is one
 * appended line of <file>.jsonl (an append is one write, so several processes of the same run can share the ledger); the
 * file <file> holds the totals of earlier runs of this ledger (a start value). hold() reads the shared total first.
 */
export function createLedger(file, capUsd) {
  let base = { usd: 0, calls: 0, byRole: {}, refused: 0 };
  if (file && existsSync(file)) base = { ...base, ...JSON.parse(readFileSync(file, 'utf8')) };
  const lines = file ? file + '.jsonl' : '';
  let mine = [];   // without a file: in memory only
  let held = 0;
  const all = () => {
    const s = JSON.parse(JSON.stringify(base));
    const rows = lines && existsSync(lines) ? readFileSync(lines, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : mine;
    for (const b of rows) {
      s.usd += b.usd; s.calls++;
      const r = s.byRole[b.role] || (s.byRole[b.role] = { usd: 0, calls: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
      r.usd += b.usd; r.calls++; for (const k of ['in', 'out', 'cacheRead', 'cacheWrite']) r[k] += b[k] || 0;
    }
    return s;
  };
  return {
    capUsd,
    get: () => ({ ...all(), heldUsd: held }),
    left: () => capUsd - all().usd - held,
    /** reserve the worst case of a call; throws code 'cap' when the cap would be passed */
    hold(worst) {
      if (all().usd + held + worst > capUsd) { const e = new Error('cost cap reached'); e.code = 'cap'; throw e; }
      held += worst;
      return () => { held -= worst; };
    },
    book(role, usd, u = {}) {
      const row = { role, usd, in: u.in || 0, out: u.out || 0, cacheRead: u.cacheRead || 0, cacheWrite: u.cacheWrite || 0 };
      if (lines) { mkdirSync(dirname(lines), { recursive: true }); writeFileSync(lines, JSON.stringify(row) + '\n', { flag: 'a' }); } else mine.push(row);
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** fetch with retries on 429, 529 and 5xx (retry-after honoured, exponential backoff with jitter), at most `tries` times */
export function retryingFetch(base = fetch, { tries = 6, baseMs = 1500, log = () => {} } = {}) {
  return async (url, opts) => {
    for (let i = 0; ; i++) {
      let r;
      try { r = await base(url, opts); } catch (e) { if (i + 1 >= tries || (opts && opts.signal && opts.signal.aborted)) throw e; log({ retry: i + 1, why: 'net' }); await sleep(baseMs * 2 ** i); continue; }
      if (r.status !== 429 && r.status !== 529 && !(r.status >= 500 && r.status < 600)) return r;
      if (i + 1 >= tries) return r;
      const ra = Number(r.headers && r.headers.get && r.headers.get('retry-after'));
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : baseMs * 2 ** i;
      log({ retry: i + 1, status: r.status });
      await sleep(wait + Math.floor(Math.random() * 500));
    }
  };
}

/** A small concurrency limiter: limit(fn) runs at most n at once */
export function limiter(n) {
  let active = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; const { fn, ok, no } = q.shift(); fn().then(ok, no).finally(() => { active--; next(); }); };
  return (fn) => new Promise((ok, no) => { q.push({ fn, ok, no }); next(); });
}

/**
 * client({ key, ledger, fetchImpl }) -> call({ role, model, system, user, schema, maxTokens, effort, timeoutMs })
 *   -> { json, raw, stop, usage, usd }. system: string (cached, 1h) or [{ text, cache }]. Structured output via
 *   output_config.format; no sampling parameters (API version 2026-10-21 rejects them).
 */
export function client({ key, ledger, fetchImpl = retryingFetch(), version = '2026-10-21', base = 'https://api.anthropic.com' }) {
  return async function call({ role, model, system, user, schema, maxTokens = 1500, effort = 'low', timeoutMs = 120000 }) {
    const sys = (Array.isArray(system) ? system : [{ text: String(system || ''), cache: true }]);
    const last = sys.map((b) => !!b.cache).lastIndexOf(true);
    const body = {
      model, max_tokens: maxTokens,
      system: sys.map((b, i) => ({ type: 'text', text: b.text, ...(i === last ? { cache_control: { type: 'ephemeral', ttl: '1h' } } : {}) })),
      messages: [{ role: 'user', content: user }],
      output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
    };
    const worst = usdOf(model, { cacheWrite: Math.ceil(JSON.stringify(body).length / 2.5), out: maxTokens });
    const release = ledger.hold(worst);
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), timeoutMs);
    let j;
    try {
      const r = await fetchImpl(base + '/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'x-api-key': key, 'anthropic-version': version, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) { const e = new Error('http-' + r.status); e.code = 'http'; e.status = r.status; try { e.detail = String((await r.json()).error.message).slice(0, 200); } catch { /* none */ } throw e; }
      j = await r.json();
    } catch (e) {
      if (e.code !== 'http') ledger.book(role, worst, {});   // never read: may be billed
      throw e;
    } finally { clearTimeout(to); release(); }
    const u0 = j.usage || {};
    const usage = { in: u0.input_tokens || 0, out: u0.output_tokens || 0, cacheRead: u0.cache_read_input_tokens || 0, cacheWrite: u0.cache_creation_input_tokens || 0 };
    const usd = usdOf(model, usage);
    ledger.book(role, usd, usage);
    const raw = (Array.isArray(j.content) ? j.content : []).filter((c) => c && c.type === 'text').map((c) => c.text).join('');
    let json = null;
    if (j.stop_reason !== 'refusal' && j.stop_reason !== 'max_tokens') { try { json = JSON.parse(raw); } catch { json = null; } }
    return { json, raw, stop: j.stop_reason || '', usage, usd };
  };
}

/** Append one JSON line (the iteration log is append-only) */
export function appendJsonl(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj) + '\n', { flag: 'a' });
}
