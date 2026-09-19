/**
 * Pure statistics helpers for the RQ1 table: two-proportion z-test and Fisher's exact test
 * (protocol.md §5: "Two-proportion z-test (or Fisher's exact test when any cell count <5,
 * standard for small-sample proportions) per task per arm-pair, two-sided"). No external
 * stats dependency: log-gamma (Lanczos) for exact hypergeometric probabilities, erf
 * approximation (Abramowitz & Stegun 7.1.26, max error 1.5e-7) for the normal CDF.
 */

function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export interface TestResult {
  test: "z" | "fisher" | "undefined";
  p_value: number | null;
  statistic: number | null;
  note?: string;
}

/** Two-proportion z-test, pooled variance, two-sided. */
export function twoProportionZTest(x1: number, n1: number, x2: number, n2: number): TestResult {
  if (n1 === 0 || n2 === 0) return { test: "z", p_value: null, statistic: null, note: "empty arm" };
  const p1 = x1 / n1, p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { test: "z", p_value: p1 === p2 ? 1 : 0, statistic: p1 === p2 ? 0 : Infinity };
  const z = (p1 - p2) / se;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { test: "z", p_value: Math.min(1, Math.max(0, p)), statistic: z };
}

/**
 * Fisher's exact test, two-sided, on a 2x2 table:
 *        pass  fail
 * arm1:   a     b
 * arm2:   c     d
 * Sums the hypergeometric probability of every table at least as extreme as the observed one
 * (same margins), the standard two-sided definition (probabilities <= observed, within a small
 * relative tolerance for floating-point equality).
 */
export function fisherExactTest(a: number, b: number, c: number, d: number): TestResult {
  const row1 = a + b, row2 = c + d, col1 = a + c, n = row1 + row2;
  if (row1 === 0 || row2 === 0 || col1 === 0 || col1 === n) return { test: "fisher", p_value: 1, statistic: null, note: "degenerate margins" };
  const logDenom = logChoose(n, col1);
  const logPObserved = logChoose(row1, a) + logChoose(row2, col1 - a) - logDenom;
  const kMin = Math.max(0, col1 - row2), kMax = Math.min(row1, col1);
  const epsilon = 1e-7;
  let p = 0;
  for (let k = kMin; k <= kMax; k++) {
    const logPk = logChoose(row1, k) + logChoose(row2, col1 - k) - logDenom;
    if (logPk <= logPObserved + epsilon) p += Math.exp(logPk);
  }
  return { test: "fisher", p_value: Math.min(1, Math.max(0, p)), statistic: null };
}

/** protocol.md §5: z-test unless any of the four 2x2 cells is <5, then Fisher's exact. */
export function proportionTest(passA: number, failA: number, passC: number, failC: number): TestResult {
  if ([passA, failA, passC, failC].some((v) => v < 5)) return fisherExactTest(passA, failA, passC, failC);
  return twoProportionZTest(passA, passA + failA, passC, passC + failC);
}

/** Holm-Bonferroni step-down adjusted p-values (monotone, capped at 1), returned in input order. */
export function holmBonferroni(pValues: number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(m);
  let running = 0;
  order.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    adjusted[i] = running;
  });
  return adjusted;
}
