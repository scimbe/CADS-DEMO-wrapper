#!/usr/bin/env node
// Live acceptance of the free card (W2 and W3) against the real model, through exactly the server's path:
// read -> screenInput (S1) -> runKarte (S2, S3, S4) with the model layer lib/duell-llm.mjs.
//
//   DUELL_CARD_PROVIDER=anthropic DUELL_ANTHROPIC_KEY_FILE=~/.config/cads/anthropic.key node bin/duell-karte-golden.mjs [--arts card,game] [--golden] [--out r.json]
//   DUELL_CARD_PROVIDER=litellm DUELL_CARD_MODEL=local-qwen36-35b-a3b-coding DUELL_OLLAMA_WINDOW=22-6 LITELLM_BASE_URL=... LITELLM_KEY_FILE=... node bin/duell-karte-golden.mjs
//
// --arts (default: all of test/fixtures/karte-arts.json): per description a card must come back that the app keeps as it
// is (sanitizeDoc), that fits a link (<= 1200) and that FITS THE INPUT: one entry of `want` appears in its texts, emoji,
// theme or chosen ability. A status or an answer alone is not counted. --golden: the 141 malicious inputs must never become
// a card (S1 or the model refuse), the harmless ones should (>= 95 %). Prints numbers and the cards' texts (test data only),
// never a key.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { foldForFilter } from '../lib/duell.mjs';
import { KINDS, screenInput } from '../lib/duell-ai.mjs';
import { App, LINK_MAX, linkOf, textsOf } from '../lib/duell-karte.mjs';
import { createLlm, hitRate } from '../lib/duell-llm.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const has = (k) => args.includes('--' + k);
const home = (p) => String(p || '').replace(/^~(?=\/)/, homedir());
const fx = (f) => JSON.parse(readFileSync(fileURLToPath(new URL('../test/fixtures/' + f, import.meta.url)), 'utf8'));
const K = KINDS.karte;
const fold = (s) => foldForFilter(String(s)).replace(/ä/g, 'a');

/** Does the card fit the description? One wanted stem, emoji, theme or ability id in what the card shows or is. */
export function fits(doc, want) {
  const hay = fold([textsOf(doc), doc.i, doc.g && doc.g.theme, doc.g && doc.g.route && doc.g.route.map((r) => r.t + ' ' + r.p).join(' '), doc.st].filter(Boolean).join(' '));
  return want.some((w) => hay.includes(fold(w)));
}

async function one(llm, t, art, lang) {
  const data = K.read({ text: t, art, age: 'a18' });
  const s = screenInput(K, data);
  if (s) return { ok: false, why: 's1-' + s };
  try {
    const r = await K.run(data, lang, { llm });
    if (r.fail) return { ok: false, why: r.fail + (r.why ? ':' + r.why : '') };
    const doc = r.options[0].doc, kept = JSON.stringify(App.D.sanitizeDoc(doc)) === JSON.stringify(doc), link = [...linkOf(doc)].length;
    return { ok: kept && link <= LINK_MAX, doc, link, kept };
  } catch (e) { return { ok: false, why: 'error:' + (e.code || e.message) }; }
}

async function main() {
  const llmEnv = { LITELLM_BASE_URL: process.env.LITELLM_BASE_URL, LITELLM_API_KEY: process.env.LITELLM_API_KEY || (process.env.LITELLM_KEY_FILE ? readFileSync(home(process.env.LITELLM_KEY_FILE), 'utf8').trim() : '') };
  const llm = createLlm({ env: { ...process.env, DUELL_ANTHROPIC_KEY_FILE: home(process.env.DUELL_ANTHROPIC_KEY_FILE), DUELL_CARD_BUDGET_USD: process.env.DUELL_CARD_BUDGET_USD || '1' }, llmEnv, log: () => {} });
  if (!llm.configured) { console.error(`provider ${llm.provider} is not configured`); process.exit(2); }
  const result = { provider: llm.provider, model: llm.model, arts: {} };
  const sets = fx('karte-arts.json').arts, want = arg('arts', has('golden') && !arg('arts') ? '' : Object.keys(sets).join(','));
  for (const art of want.split(',').filter(Boolean)) {
    const rows = [];
    for (const c of sets[art]) {
      const r = await one(llm, c.t, art, c.lang), fit = r.ok ? fits(r.doc, c.want) : false;
      rows.push({ t: c.t, ok: r.ok, fit, why: r.why || '', link: r.link || 0, shows: r.doc ? textsOf(r.doc).slice(0, 160) : '', cap: r.doc && r.doc.i ? r.doc.i : undefined });
      console.log(JSON.stringify({ art, ok: r.ok, fit, why: r.why || '', link: r.link || 0, t: c.t, shows: r.doc ? textsOf(r.doc).slice(0, 120) : '', cap: r.doc && r.doc.i }));
    }
    result.arts[art] = { n: rows.length, valid: rows.filter((x) => x.ok).length, fit: rows.filter((x) => x.fit).length, rows };
  }
  if (has('golden')) {
    const g = fx('karte-golden.json'), bad = [], good = [];
    for (const b of g.bad) { const r = await one(llm, b.t, 'card', b.lang); bad.push({ t: b.t, cat: b.cat, through: r.ok, why: r.why || '' }); }
    for (const x of g.good) { const r = await one(llm, x.t, x.art, x.lang); good.push({ t: x.t, ok: r.ok, why: r.why || '' }); }
    result.golden = { bad: bad.length, through: bad.filter((x) => x.through), good: good.length, pass: good.filter((x) => x.ok).length, blockedGood: good.filter((x) => !x.ok) };
  }
  const st = llm.stats();
  result.usage = { calls: st.calls, in: st.in, out: st.out, cacheRead: st.cacheRead, cacheWrite: st.cacheWrite, hitRate: Math.round(hitRate(st) * 1000) / 1000 };
  result.usd = Math.round(st.usd * 1e6) / 1e6;
  const summary = { arts: Object.fromEntries(Object.entries(result.arts).map(([k, v]) => [k, `${v.valid}/${v.n} valid, ${v.fit}/${v.n} fit`])), golden: result.golden && { through: result.golden.through.length + '/' + result.golden.bad, pass: result.golden.pass + '/' + result.golden.good }, usage: result.usage, usd: result.usd };
  console.log(JSON.stringify(summary));
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(result, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.code || e.message); process.exit(2); });
