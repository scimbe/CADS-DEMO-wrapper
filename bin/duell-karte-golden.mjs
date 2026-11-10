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
// --vorschlag (test/fixtures/karte-vorschlag.json): the fixed refusal of lib/duell-absage.mjs. Every case runs the server's
// order (S1 crisis, hard, soft -> the table; then runKarte): soft cases should end "absage" (200 notyet, no strike), with an
// alt only from the table (alt.id in the vendored ideas.json or a genre G1|G2|G11|G12|G15); hard ones never get one. --follow
// also sends each alt.satz (kind genre) as a new, normal request. --dry: a stub model, no API call and no key (S2 harmless,
// S3 ok:false), for a run of the whole path without cost. The key is read from the environment (ANTHROPIC_API_KEY) or
// DUELL_ANTHROPIC_KEY_FILE by lib/duell-llm.mjs, never printed; DUELL_CARD_BUDGET_USD is the hard limit of the run.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { foldForFilter } from '../lib/duell.mjs';
import { KINDS, screenInput } from '../lib/duell-ai.mjs';
import { App, LINK_MAX, MOD_SYSTEM, linkOf, textsOf } from '../lib/duell-karte.mjs';
import { altOk } from '../lib/duell-absage.mjs';
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

/** The outcome of one case as the person would see it: ok (a card), absage+alt, absage (no alt), alt-falsch (an alt that is
 * no catalog id and no genre), hart, crisis, error. alt is an object of the table: { kind, id, satz } */
export function outcomeOf(r) {
  if (r.error) return 'error';
  if (r.crisis || r.fail === 'crisis') return 'crisis';
  if (r.s1) return 'hart';
  if (r.notyet) return r.alt == null ? 'absage' : altOk(r.alt) ? 'absage+alt' : 'alt-falsch';
  if (r.options) return 'ok';
  return 'hart';
}
/** soft: a refusal of the table (with or without alt); hard: anything but a refusal of the table or a card */
export const vorschlagPass = (kind, outcome) => (kind === 'soft' ? ['absage', 'absage+alt'].includes(outcome) : ['hart', 'crisis'].includes(outcome));

/** One wish through act's order: S1 (crisis, hard, soft -> the table, no model), then runKarte */
async function vorschlagOne(llm, t, art, lang) {
  const data = K.read({ text: t, art });
  data.age = 'a18';
  const s = screenInput(K, data);
  if (s === 'crisis') return { crisis: true };
  if (s) { const soft = K.soft(data); if (!soft) return { s1: true }; return K.absage(data, soft); }
  try { return await K.run(data, lang, { llm }); } catch (e) { return { error: e.code || e.message }; }
}
async function vorschlag(llm, follow) {
  const g = fx('karte-vorschlag.json'), rows = [];
  // absage: a game the free card does not have, with the recorded answer of the server (its reason must come again)
  for (const kind of ['soft', 'hard', 'absage']) for (const c of g[kind] || []) {
    const r = await vorschlagOne(llm, c.t, c.art, c.lang), outcome = outcomeOf(r);
    const pass = kind === 'absage' ? vorschlagPass('soft', outcome) && r.reason === c.antwort.reason : vorschlagPass(kind, outcome);
    const row = { kind, cat: c.cat || (c.antwort && c.antwort.reason), art: c.art, t: c.t, outcome, why: r.why || (r.s1 ? 's1' : r.error || ''), reason: r.reason || '', alt: r.alt || null, pass };
    // a genre proposal is a sentence the person may send: as a new, normal request through the whole path
    if (follow && r.alt && r.alt.satz && r.alt.kind === 'genre') { const f = await vorschlagOne(llm, r.alt.satz, 'game', c.lang); row.follow = outcomeOf(f); if (f.options) row.followShows = textsOf(f.options[0].doc).slice(0, 100); }
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  return rows;
}

/** --dry: a model that answers without the API (S2 harmless, S3 ok:false); counts its calls like lib/duell-llm.mjs */
export function dryLlm() {
  let calls = 0;
  return {
    provider: 'dry', model: 'stub', configured: true,
    async generate(req) { calls++; return { json: req.system === MOD_SYSTEM ? { risk: 0, cats: [], drink: 'none' } : { ok: false }, stop: 'end_turn', usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 } }; },
    stats: () => ({ calls, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, usd: 0 }),
  };
}

async function main() {
  const llmEnv = { LITELLM_BASE_URL: process.env.LITELLM_BASE_URL, LITELLM_API_KEY: process.env.LITELLM_API_KEY || (process.env.LITELLM_KEY_FILE ? readFileSync(home(process.env.LITELLM_KEY_FILE), 'utf8').trim() : '') };
  const llm = has('dry') ? dryLlm() : createLlm({ env: { ...process.env, DUELL_ANTHROPIC_KEY_FILE: home(process.env.DUELL_ANTHROPIC_KEY_FILE), DUELL_CARD_BUDGET_USD: process.env.DUELL_CARD_BUDGET_USD || '1' }, llmEnv, log: () => {} });
  if (!llm.configured) { console.error(`provider ${llm.provider} is not configured`); process.exit(2); }
  const result = { provider: llm.provider, model: llm.model, arts: {} };
  const sets = fx('karte-arts.json').arts, want = arg('arts', (has('golden') || has('vorschlag')) && !arg('arts') ? '' : Object.keys(sets).join(','));
  for (const art of want.split(',').filter(Boolean)) {
    const rows = [];
    for (const c of sets[art]) {
      const r = await one(llm, c.t, art, c.lang), fit = r.ok ? fits(r.doc, c.want) : false;
      rows.push({ t: c.t, ok: r.ok, fit, why: r.why || '', link: r.link || 0, shows: r.doc ? textsOf(r.doc).slice(0, 160) : '', cap: r.doc && r.doc.i ? r.doc.i : undefined });
      console.log(JSON.stringify({ art, ok: r.ok, fit, why: r.why || '', link: r.link || 0, t: c.t, shows: r.doc ? textsOf(r.doc).slice(0, 120) : '', cap: r.doc && r.doc.i }));
    }
    result.arts[art] = { n: rows.length, valid: rows.filter((x) => x.ok).length, fit: rows.filter((x) => x.fit).length, rows };
  }
  if (has('vorschlag')) {
    const rows = await vorschlag(llm, has('follow'));
    result.vorschlag = { rows, soft: rows.filter((x) => x.kind === 'soft').length, softOk: rows.filter((x) => x.kind === 'soft' && x.pass).length, softAlt: rows.filter((x) => x.kind === 'soft' && x.outcome === 'absage+alt').length,
      hard: rows.filter((x) => x.kind === 'hard').length, hardOk: rows.filter((x) => x.kind === 'hard' && x.pass).length,
      absage: rows.filter((x) => x.kind === 'absage').length, absageOk: rows.filter((x) => x.kind === 'absage' && x.pass).length, altFalsch: rows.filter((x) => x.outcome === 'alt-falsch').length,
      followOk: rows.filter((x) => x.follow === 'ok').length, followN: rows.filter((x) => x.follow).length };
    console.log('\n| Kategorie | Art | erwartet | outcome | reason | alt |\n|---|---|---|---|---|---|');
    for (const x of rows) console.log(`| ${x.cat} | ${x.art} | ${x.kind === 'hard' ? 'hart' : 'absage'} | ${x.outcome}${x.why && !['ok', 'absage', 'absage+alt'].includes(x.outcome) ? ' (' + x.why + ')' : ''} | ${x.reason} | ${x.alt ? x.alt.kind + ':' + x.alt.id + (x.follow ? ' -> ' + x.follow : '') : ''} |`);
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
  const summary = { arts: Object.fromEntries(Object.entries(result.arts).map(([k, v]) => [k, `${v.valid}/${v.n} valid, ${v.fit}/${v.n} fit`])), golden: result.golden && { through: result.golden.through.length + '/' + result.golden.bad, pass: result.golden.pass + '/' + result.golden.good },
    vorschlag: result.vorschlag && { softAbsage: result.vorschlag.softOk + '/' + result.vorschlag.soft, softMitAlt: result.vorschlag.softAlt + '/' + result.vorschlag.soft, hardOhneAlt: result.vorschlag.hardOk + '/' + result.vorschlag.hard, spielAbsage: result.vorschlag.absageOk + '/' + result.vorschlag.absage, altFalsch: result.vorschlag.altFalsch, ...(result.vorschlag.followN ? { altBaut: result.vorschlag.followOk + '/' + result.vorschlag.followN } : {}) }, usage: result.usage, usd: result.usd };
  console.log(JSON.stringify(summary));
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(result, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.code || e.message); process.exit(2); });
