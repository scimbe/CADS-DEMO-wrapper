// Harness swarm: the system under test. One prompt goes exactly the server's way for the free card (lib/duell-ai.mjs act):
// read -> screenInput (S1: crisis help, hard block, soft -> the fixed refusal table) -> runKarte (S2, S3, S4, S5) with the
// real model layer lib/duell-llm.mjs (Claude Haiku 5.5, effort low as in production). libDir: the lib folder to measure
// (the worktree's own, or a candidate copy with a changed harness config), imported dynamically.
//
// The correction path after the first card: the editor's "Wunsch" (KINDS.wish, apps/duell-web src/blasen.js) for the
// card types that have it. In production that kind runs on LITELLM_DEFAULT_MODEL (a local model); here it runs on Haiku 5.5
// as a stand-in (labelled so in the report). "Verwerfen" and a new sentence is runCase again.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

const perCase = new AsyncLocalStorage();

const WISH_TYPE = { card: 'card', photo: 'photo', game: 'game', duel: 'duel' };
export const wishTypeOf = (doc) => (!doc ? '' : doc.k === 'turn' ? (doc.pk ? '' : 'turn') : WISH_TYPE[doc.k] || '');

export async function loadSut(libDir, { key, ledger, fetchImpl, call, now = () => Date.now() }) {
  const ai = await import(pathToFileURL(join(libDir, 'duell-ai.mjs')).href);
  const karte = await import(pathToFileURL(join(libDir, 'duell-karte.mjs')).href);
  const llmMod = await import(pathToFileURL(join(libDir, 'duell-llm.mjs')).href);
  const env = { DUELL_CARD_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: key, DUELL_CARD_BUDGET_USD: '1000', DUELL_CARD_BUDGET_MONTH_USD: '1000', DUELL_CARD_EFFORT: 'low' };
  const base = llmMod.createLlm({ env, fetchImpl, log: () => {} });
  // every SUT call books into the run's ledger (worst case held while it runs)
  const llm = {
    ...base,
    async generate(req) {
      const worst = (Math.ceil(JSON.stringify(req).length / 2.5) * 0.20 + (req.maxTokens || 800) * 0.50) / 1e6;
      const release = ledger.hold(worst);
      try { const r = await base.generate(req); ledger.book('sut', r.usd, r.usage); const acc = perCase.getStore(); if (acc) acc.usd += r.usd; return r; }
      catch (e) { if (!e.code && !/^llm-http-/.test(String(e.message))) ledger.book('sut', worst); throw e; }
      finally { release(); }
    },
  };
  const K = ai.KINDS.karte;

  /** c: { text, art, genre?, age: 'u18'|'a18', lang } -> the server's outcome object (+ calls, usd of this case) */
  async function runCase(c) {
    let calls = 0; const acc = { usd: 0 };
    const out = await perCase.run(acc, async () => {
      const data = K.read({ text: c.text, art: c.art, ...(c.genre ? { genre: c.genre } : {}), ...(c.fest ? { fest: true } : {}) });
      data.age = c.age === 'a18' ? 'a18' : 'u18';
      if (!K.need(data)) return { fail: 'need', why: K.why(data) };
      const s = ai.screenInput(K, data);
      if (s === 'crisis') return { crisis: true };
      if (s) { const soft = K.soft(data); if (!soft) return { s1: true }; return { ...K.absage(data, soft), soft }; }
      try { return await K.run(data, c.lang, { llm, onCall: () => calls++, now: now() }); }
      catch (e) { if (e.code === 'cap') throw e; return { error: e.code || e.message }; }
    });
    return { ...out, calls, usd: acc.usd };
  }

  /** The editor's Wunsch on a made card -> { changes, note } | { fail } ; idea: the catalog title of an ability card */
  async function runWish(doc, wish, lang, ideaTitle = '') {
    const type = wishTypeOf(doc);
    if (!type) return { fail: 'no-wish' };
    const def = ai.KINDS.wish;
    const now0 = { x: doc.x || '', y: doc.y || '', title: (doc.g && doc.g.title) || '', t: doc.t || '', st: doc.st || '' };
    const data = def.read({ type, wish, idea: ideaTitle, now: now0 });
    if (!def.need(data)) return { fail: 'need' };
    const s = ai.screenInput(def, data);
    if (s) return { fail: s };
    const callFn = async (system, user, opts = {}) => {
      const r = await call({ role: 'sut-wish', model: 'claude-haiku-5-5', system, user, maxTokens: 3000, effort: 'low' });   // Haiku 5.5 thinks first: the local model's 600 tokens would cut it
      return { text: r.raw, usage: { completion_tokens: r.usage.out } };
    };
    try {
      const r = await ai.runKind(def, data, lang, callFn);
      return r.options ? r.options[0] : { fail: r.fail };
    } catch (e) { if (e.code === 'cap') throw e; return { fail: 'error:' + (e.code || e.message) }; }
  }

  return { runCase, runWish, karte, ai, byId: (id) => karte.App.D.byId(id), llm };
}
