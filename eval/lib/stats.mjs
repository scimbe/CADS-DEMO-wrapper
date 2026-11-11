// Harness swarm: pure statistics. Surface features of a typed prompt (realism, part b), the reward of a graded result,
// the paired bootstrap of a reward difference, and small helpers for the report. No model, no I/O.

import { rng } from './population.mjs';

const EMOJI = /\p{Extended_Pictographic}/u;
const IMPERATIVE = /^(?:bitte\s+)?(?:mach|mache|macht|erstell|erstelle|erstellt|schreib|schreibe|zeig|zeige|gib|bau|baue|generier|generiere|gestalte|entwirf|plane|such|make|create|write|give|build|generate|design|draw|show|plan|need|ich brauche|ich will|ich möchte|ich moechte|i want|i need|i'd like)\b/i;
const POLITE = /\b(bitte|bitteschön|danke|please|könntest du|koenntest du|kannst du mir|could you|would you|würdest du|wuerdest du)\b/i;
const QUESTION_START = /^(?:wie|was|wann|wo|wer|welche[rsnm]?|warum|kann|kannst|gibt es|geht|how|what|when|where|who|which|why|can|could|is there|do you)\b/i;
const FAMILY = /\b(oma|opa|omi|opi|mama|papa|mutti|vati|mami|papi|tante|onkel|schwester|bruder|tochter|sohn|enkel\w*|nichte|neffe|schwiegermutter|frau|mann|freundin|freund|chef\w*|kolleg\w*|nachbar\w*|grandma|grandpa|mum|mom|dad|sister|brother|daughter|son|wife|husband|boss|colleague|neighbou?r)\b/i;
const LLMISH = /\b(erstelle (?:mir )?(?:bitte )?eine? (?:ansprechende|kreative|liebevoll gestaltete|personalisierte)|die (?:folgende|folgenden)|folgende elemente|beinhalten|ansprechend gestaltet|mit folgenden|zielgruppe|tonalität|stichpunkte|please create an? (?:engaging|creative|personali[sz]ed)|the following|should include|target audience)\b/i;

/** Surface features of one typed prompt. names: a Set of first names (lib/duell-ai.mjs FIRST_NAMES) */
export function featuresOf(text, names = new Set()) {
  const t = String(text || ''), words = t.trim().split(/\s+/).filter(Boolean);
  const letters = t.match(/\p{L}/gu) || [];
  const first = letters[0] || '';
  return {
    chars: [...t].length,
    words: words.length,
    lowerStart: !!first && first === first.toLowerCase() && first !== first.toUpperCase(),
    allLower: letters.length > 0 && !letters.some((c) => c !== c.toLowerCase()),
    emoji: EMOJI.test(t),
    question: /\?/.test(t) || QUESTION_START.test(t.trim()),
    imperative: IMPERATIVE.test(t.trim()),
    polite: POLITE.test(t),
    named: words.some((w) => names.has(w.replace(/[^\p{L}-]/gu, ''))),
    family: FAMILY.test(t),
    endPunct: /[.!?…]\s*$/.test(t),
    listy: /\n|^\s*[-*•]|\d\)\s/m.test(t) || (t.match(/,/g) || []).length >= 4,
    llmish: LLMISH.test(t),
  };
}
const SHARE_KEYS = ['lowerStart', 'allLower', 'emoji', 'question', 'imperative', 'polite', 'named', 'family', 'endPunct', 'listy', 'llmish'];
/** Distribution of a list of feature objects -> { n, words: {p10,p50,p90,mean}, chars: {...}, hist, shares: {key: share} } */
export function distribution(feats) {
  const n = feats.length, q = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const w = feats.map((f) => f.words), c = feats.map((f) => f.chars);
  const bins = [[1, 2], [3, 5], [6, 10], [11, 15], [16, 25], [26, 40], [41, 1e9]];
  const hist = Object.fromEntries(bins.map(([a, b]) => [b > 1e8 ? `${a}+` : `${a}-${b}`, w.filter((x) => x >= a && x <= b).length]));
  const shares = Object.fromEntries(SHARE_KEYS.map((k) => [k, n ? feats.filter((f) => f[k]).length / n : 0]));
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  return { n, words: { p10: q(w, 0.1), p50: q(w, 0.5), p90: q(w, 0.9), mean: mean(w) }, chars: { p10: q(c, 0.1), p50: q(c, 0.5), p90: q(c, 0.9), mean: mean(c) }, hist, shares };
}

// ---- reward -----------------------------------------------------------------------------------------------------------
/** Weights of the four judge dimensions (0-4 each). Routing/honesty weighs most (a wrong substitute is the worst outcome). */
export const WEIGHTS = Object.freeze({ routing: 0.35, intent: 0.30, vorstellung: 0.20, quality: 0.15 });
/** A result passes when its reward is at least PASS_AT and routing is not a wrong substitute (>= 2). */
export const PASS_AT = 0.65;
/** -> reward in [0,1]; a routing score of 0 (wrong substitute) caps the reward at 0.25 */
export function rewardOf(s) {
  if (!s) return 0;
  const v = (k) => Math.max(0, Math.min(4, Number(s[k]) || 0)) / 4;
  const r = Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + w * v(k), 0);
  return (Number(s.routing) || 0) === 0 ? Math.min(r, 0.25) : r;
}
export const passOf = (s) => !!s && rewardOf(s) >= PASS_AT && (Number(s.routing) || 0) >= 2;

/** Mean and a percentile bootstrap 95 % CI of a list of numbers */
export function meanCi(xs, { B = 2000, seed = 11 } = {}) {
  const n = xs.length; if (!n) return { n: 0, mean: 0, lo: 0, hi: 0 };
  const mean = xs.reduce((s, x) => s + x, 0) / n, r = rng(seed), ms = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += xs[Math.floor(r() * n)]; ms.push(s / n); }
  ms.sort((a, b) => a - b);
  return { n, mean, lo: ms[Math.floor(0.025 * B)], hi: ms[Math.min(B - 1, Math.floor(0.975 * B))] };
}
/** Paired bootstrap of mean(after - before) over the ids both have -> { n, delta, lo, hi } */
export function pairedDelta(before, after, opts) {
  const ids = Object.keys(after).filter((id) => id in before);
  const d = ids.map((id) => after[id] - before[id]);
  const m = meanCi(d, opts);
  return { n: m.n, delta: m.mean, lo: m.lo, hi: m.hi };
}
/** Linear weighted kappa of two raters on an ordinal 0..k scale: pairs [[a,b],...] */
export function weightedKappa(pairs, k = 4) {
  const n = pairs.length; if (!n) return 0;
  const w = (i, j) => 1 - Math.abs(i - j) / k;
  const ra = Array(k + 1).fill(0), rb = Array(k + 1).fill(0);
  let po = 0;
  for (const [a, b] of pairs) { po += w(a, b); ra[a]++; rb[b]++; }
  po /= n;
  let pe = 0;
  for (let i = 0; i <= k; i++) for (let j = 0; j <= k; j++) pe += w(i, j) * (ra[i] / n) * (rb[j] / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
/** Group rows by key fn -> { key: rows } */
export function groupBy(rows, fn) { const o = {}; for (const r of rows) { const k = fn(r); (o[k] = o[k] || []).push(r); } return o; }
