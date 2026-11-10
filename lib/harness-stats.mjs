// Statistics of the harness gate (bin/duell-karte-golden.mjs --v21): Wilson interval, Rule of Three, exact paired McNemar
// and Cohen's kappa. Pure functions, no dependencies, so the gate's numbers can be checked by hand.
//
// Wilson 1927 (score interval, z = 1.96 for 95 %); Rule of Three (Hanley & Lippman-Hand 1983): with 0 hits in n trials
// the upper 95 % bound is about 3/n; McNemar 1947, exact form = two-sided binomial test on the discordant pairs (b, c)
// with p = 0.5; Cohen 1960 for two raters on the same items.

export const Z95 = 1.959964;

/** Lower bound of the Wilson score interval for k hits in n trials. n = 0 -> 0 (nothing measured is never a pass). */
export function wilsonLower(k, n, z = Z95) {
  if (!(n > 0)) return 0;
  const p = k / n, z2 = z * z;
  const c = p + z2 / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (c - m) / (1 + z2 / n));
}

/** Upper bound of the Wilson score interval. n = 0 -> 1 (nothing measured is never below a limit). */
export function wilsonUpper(k, n, z = Z95) {
  if (!(n > 0)) return 1;
  const p = k / n, z2 = z * z;
  const c = p + z2 / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, (c + m) / (1 + z2 / n));
}

/** "k/n" and, for k = 0, the Rule-of-Three bound as text: "0/270 (< 3/270 = 1,11 %)". */
export function ruleOfThree(k, n) {
  if (k > 0 || !(n > 0)) return `${k}/${n}`;
  return `0/${n} (< 3/${n} = ${Math.min(100, 300 / n).toFixed(2).replace('.', ',')} %)`;
}

/** log of n choose i, exact enough for n up to some thousands */
function logChoose(n, i) {
  let s = 0;
  for (let j = 1; j <= i; j++) s += Math.log(n - i + j) - Math.log(j);
  return s;
}

/** Exact two-sided McNemar p-value from the discordant counts b (pass -> fail) and c (fail -> pass). */
export function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const m = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= m; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

/**
 * Paired comparison of two runs on the same cases. vorher, nachher: { id: pass(boolean) }. Only ids in both count.
 * -> { n, a, b, c, d, p, regression }: a both pass, b pass -> fail, c fail -> pass, d both fail;
 * regression = significant (p < alpha) and more cases got worse than better.
 */
export function mcnemarPaired(vorher, nachher, alpha = 0.05) {
  let a = 0, b = 0, c = 0, d = 0;
  for (const id of Object.keys(nachher)) {
    if (!(id in vorher)) continue;
    const x = !!vorher[id], y = !!nachher[id];
    if (x && y) a++; else if (x && !y) b++; else if (!x && y) c++; else d++;
  }
  const p = mcnemarExact(b, c);
  return { n: a + b + c + d, a, b, c, d, p, regression: p < alpha && b > c };
}

/** Cohen's kappa of two raters with yes/no labels on the same items: pairs = [[rater1, rater2], ...]. */
export function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return { n: 0, po: 0, pe: 0, kappa: 0 };
  let agree = 0, y1 = 0, y2 = 0;
  for (const [x, y] of pairs) { if (!!x === !!y) agree++; if (x) y1++; if (y) y2++; }
  const po = agree / n, pe = (y1 / n) * (y2 / n) + (1 - y1 / n) * (1 - y2 / n);
  return { n, po, pe, kappa: pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe) };
}
