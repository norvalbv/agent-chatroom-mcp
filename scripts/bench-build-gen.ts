/** Generator for planted-defect build tasks (tasks/build-billing-<seed>). One domain (a subscription billing
 * library, nine modules), twelve catalogued defects, a seed that fixes the numeric parameters and which
 * subset of defects is planted. src/ carries no comments; the rules live only in SPEC.md.
 *   node --import tsx scripts/bench-build-gen.ts <seed> [--out tasks/build-billing-s<seed>]
 * Hidden checks and their expected values are computed by running the correct build (oracle/expected.json).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFECT_IDS = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12'] as const;
export const DEFECT_KIND: Record<string, string> = {
  D01: 'spec-vs-code', D02: 'boundary', D03: 'boundary', D04: 'spec-vs-code', D05: 'spec-vs-code', D06: 'boundary',
  D07: 'spec-vs-code', D08: 'cross-module-contract', D09: 'cross-module-contract', D10: 'misleading-test', D11: 'boundary', D12: 'cross-module-contract',
};
export const DEFECT_MODULE: Record<string, string> = {
  D01: 'money', D02: 'calendar', D03: 'plans', D04: 'proration', D05: 'coupons', D06: 'coupons', D07: 'coupons',
  D08: 'invoice', D09: 'invoice', D10: 'dunning', D11: 'report', D12: 'report',
};

export type Params = { tierA: number; tierB: number; pa: number; pb: number; pc: number; base: number; taxBps: number; grace: number; feeBps: number; feeCap: number };
export type Instance = { seed: number; params: Params; defects: string[] };

function rng(seed: number) {
  let a = seed * 2654435761 >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function deriveInstance(seed: number): Instance {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const params: Params = {
    tierA: pick([50, 100, 200]), tierB: pick([400, 500, 1000]), pa: pick([12, 15, 20]), pb: pick([8, 9, 11]), pc: pick([5, 6, 7]),
    base: pick([4999, 3999, 5999]), taxBps: pick([825, 700, 1000]), grace: pick([5, 7, 10]), feeBps: pick([200, 300, 500]), feeCap: pick([2500, 3000, 4000]),
  };
  const ids = [...DEFECT_IDS];
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return { seed, params, defects: ids.slice(0, 9).sort() };
}

type Files = Record<string, string>;
export function buildSrc(inst: Instance, fixed: Set<string>): Files {
  const p = inst.params;
  const bad = (id: string) => inst.defects.includes(id) && !fixed.has(id);
  const src: Files = {};
  src['money.ts'] = `export function roundHalfUp(x: number): number {
  ${bad('D01') ? 'return Math.round(x);' : 'return x < 0 ? -Math.round(-x) : Math.round(x);'}
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function fmt(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return sign + (abs / 100).toFixed(2);
}
`;
  src['types.ts'] = `export type Ymd = { y: number; m: number; d: number };
export type Customer = { id: string; region: string; taxExempt: boolean };
export type Coupon = { code: string; kind: 'percent' | 'fixed'; value: number; maxCents?: number };
export type Sub = { id: string; planId: string; cycle: 'monthly' | 'annual'; cents: number; start: Ymd; end?: Ymd };
`;
  src['calendar.ts'] = `import type { Ymd } from './types.ts';

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toOrdinal(d: Ymd): number {
  return Math.round(Date.UTC(d.y, d.m - 1, d.d) / 86400000);
}

export function fromOrdinal(n: number): Ymd {
  const t = new Date(n * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function daysBetween(a: Ymd, b: Ymd): number {
  return toOrdinal(b) - toOrdinal(a);
}

export function addDays(d: Ymd, n: number): Ymd {
  return fromOrdinal(toOrdinal(d) + n);
}

export function addMonths(d: Ymd, n: number): Ymd {
  const idx = d.y * 12 + (d.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12 + 12) % 12 + 1;
${bad('D02') ? '  return fromOrdinal(toOrdinal({ y, m, d: 1 }) + d.d - 1);' : '  return { y, m, d: Math.min(d.d, daysInMonth(y, m)) };'}
}
`;
  src['plans.ts'] = `export type Tier = { upTo: number; cents: number };
export type Plan = { id: string; baseCents: number; tiers: Tier[] };

export const PLANS: Record<string, Plan> = {
  starter: { id: 'starter', baseCents: ${p.base}, tiers: [{ upTo: ${p.tierA}, cents: ${p.pa} }, { upTo: ${p.tierB}, cents: ${p.pb} }, { upTo: Infinity, cents: ${p.pc} }] },
  growth: { id: 'growth', baseCents: ${p.base * 3}, tiers: [{ upTo: ${p.tierA * 2}, cents: ${p.pa - 4} }, { upTo: ${p.tierB * 2}, cents: ${p.pb - 3} }, { upTo: Infinity, cents: ${p.pc - 2} }] },
};

export function usageCharge(plan: Plan, units: number): number {
  let prev = 0;
  let total = 0;
  for (const t of plan.tiers) {
    if (units <= prev) break;
    const n = Math.min(units, t.upTo) - prev;
    total += n * t.cents;
    prev = ${bad('D03') ? 't.upTo - 1' : 't.upTo'};
  }
  return total;
}
`;
  src['proration.ts'] = `import type { Ymd } from './types.ts';
import { daysBetween } from './calendar.ts';
import { roundHalfUp } from './money.ts';

export function remainingShare(start: Ymd, end: Ymd, from: Ymd): number {
  const total = ${bad('D04') ? '30' : 'daysBetween(start, end)'};
  return daysBetween(from, end) / total;
}

export function prorate(cents: number, start: Ymd, end: Ymd, from: Ymd): number {
  return roundHalfUp(cents * remainingShare(start, end, from));
}

export function prorateCredit(cents: number, start: Ymd, end: Ymd, from: Ymd): number {
  return roundHalfUp(-cents * remainingShare(start, end, from));
}
`;
  src['coupons.ts'] = `import type { Coupon } from './types.ts';
import { roundHalfUp } from './money.ts';

export function applyCoupons(subtotal: number, coupons: Coupon[]): { discount: number; total: number } {
  const ordered = ${bad('D05') ? '[...coupons]' : "[...coupons].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'percent' ? -1 : 1))"};
  let discount = 0;
  for (const c of ordered) {
    if (c.kind === 'percent') {
      let cut = roundHalfUp(subtotal * c.value / 10000);
      ${bad('D07') ? '' : 'if (c.maxCents !== undefined) cut = Math.min(cut, c.maxCents);'}
      discount += cut;
    } else {
      discount += c.value;
    }
  }
  ${bad('D06') ? '' : 'discount = Math.min(discount, subtotal);'}
  return { discount, total: subtotal - discount };
}
`;
  if (bad('D05')) {
    src['coupons.ts'] = src['coupons.ts']
      .replace("      let cut = roundHalfUp(subtotal * c.value / 10000);", "      let cut = roundHalfUp((subtotal - discount) * c.value / 10000);");
  }
  src['tax.ts'] = `import { roundHalfUp } from './money.ts';

export const RATES_BPS: Record<string, number> = { X: ${p.taxBps}, Y: 0, Z: 500 };

export function taxFor(region: string, cents: number): number {
  const bps = RATES_BPS[region] ?? 0;
  return roundHalfUp(cents * bps / 10000);
}
`;
  src['invoice.ts'] = `import type { Coupon, Customer } from './types.ts';
import { PLANS, usageCharge } from './plans.ts';
import { applyCoupons } from './coupons.ts';
import { taxFor } from './tax.ts';
import { sum } from './money.ts';

export type InvoiceRequest = { customer: Customer; planId: string; units: number; coupons?: Coupon[] };

export function buildInvoice(req: InvoiceRequest) {
  const plan = PLANS[req.planId];
  const lines = [
    { desc: 'base', cents: plan.baseCents },
    { desc: 'usage', cents: usageCharge(plan, req.units) },
  ];
  const subtotal = sum(lines.map((l) => l.cents));
  const { discount } = applyCoupons(subtotal, req.coupons ?? []);
  const taxable = ${bad('D08') ? 'subtotal' : 'subtotal - discount'};
  const tax = (req.customer as any).${bad('D09') ? 'tax_exempt' : 'taxExempt'} ? 0 : taxFor(req.customer.region, taxable);
  return { lines, subtotal, discount, tax, total: subtotal - discount + tax };
}
`;
  src['dunning.ts'] = `import type { Ymd } from './types.ts';
import { daysBetween } from './calendar.ts';
import { roundHalfUp } from './money.ts';

export const GRACE_DAYS = ${p.grace};
export const FEE_BPS = ${p.feeBps};
export const FEE_CAP_CENTS = ${p.feeCap};

export function lateFee(invoiceCents: number, due: Ymd, today: Ymd): number {
  const late = daysBetween(due, today);
  if (late ${bad('D10') ? '<' : '<='} GRACE_DAYS) return 0;
  return Math.min(roundHalfUp(invoiceCents * FEE_BPS / 10000), FEE_CAP_CENTS);
}
`;
  src['report.ts'] = `import type { Sub, Ymd } from './types.ts';
import { toOrdinal } from './calendar.ts';
import { roundHalfUp, sum } from './money.ts';

export function isActive(s: Sub, asOf: Ymd): boolean {
  const t = toOrdinal(asOf);
  if (t < toOrdinal(s.start)) return false;
  return s.end === undefined || t ${bad('D11') ? '<=' : '<'} toOrdinal(s.end);
}

export function monthlyValue(s: Sub): number {
  return s.cycle === 'annual' ? ${bad('D12') ? 'Math.floor(s.cents / 12)' : 'roundHalfUp(s.cents / 12)'} : s.cents;
}

export function mrr(subs: Sub[], asOf: Ymd): number {
  return sum(subs.filter((s) => isActive(s, asOf)).map(monthlyValue));
}
`;
  return src;
}

const SPEC = (p: Params) => `# Billing library specification

All money is integer cents. Dates are calendar days (\`Ymd\`); a period or subscription end date is the first day
that is NOT covered.

## money
- \`roundHalfUp(x)\` rounds to the nearest integer; exact halves round away from zero, for negative numbers too
  (-2.5 becomes -3, 2.5 becomes 3).

## calendar
- \`addMonths(d, n)\` keeps the day of month; if the target month is shorter, it uses that month's last day
  (31 Jan plus one month is 28 Feb, or 29 Feb in a leap year). It never spills into the following month.
- \`daysBetween(a, b)\` is b minus a in calendar days.

## plans
- Usage is graduated. The first ${p.tierA} units of a starter subscription cost ${p.pa} cents each, units ${p.tierA + 1} to ${p.tierB} cost ${p.pb} cents each,
  and further units cost ${p.pc} cents each. Each unit is charged at the price of the tier it falls in, once.
  (The growth plan has its own price table in \`plans.ts\` and follows the same rule.)

## proration
- \`remainingShare(start, end, from)\` is the number of days from \`from\` to \`end\` divided by the actual number of days in
  the period from \`start\` to \`end\`, whatever its length.
- \`prorate\` charges that share of an amount; \`prorateCredit\` returns the same amount as a negative credit. Both round with \`roundHalfUp\`.

## coupons
- Percent coupons (value in basis points) are added together and taken from the original subtotal; they are applied
  before fixed coupons whatever order they are listed in. A percent coupon's discount may not exceed its \`maxCents\` when it has one.
- Fixed coupons subtract their value in cents.
- The total discount never exceeds the subtotal, so an invoice total before tax is never negative.

## tax
- Region X is taxed at ${p.taxBps} basis points, Z at 500, others at 0. Tax is on the amount after discount and is rounded once per invoice with \`roundHalfUp\`.
- A customer with \`taxExempt: true\` is charged no tax.

## invoice
- An invoice has a base line and a usage line. The subtotal is their sum. Discount, tax and total follow the rules above:
  total = subtotal - discount + tax.

## dunning
- No late fee is charged while an invoice is at most ${p.grace} days past its due date. From the day after that, the fee is
  ${p.feeBps / 100}% of the invoice (\`roundHalfUp\`), capped at ${p.feeCap} cents.

## report
- A subscription is active on \`asOf\` from its start day up to but not including its end day; with no end it stays active.
- Monthly recurring revenue (MRR) is the sum of the monthly value of the active subscriptions. An annual subscription's monthly
  value is its annual amount divided by 12, rounded with \`roundHalfUp\`.
`;

const BRIEF = `The library in src/ must meet the specification in SPEC.md. The public tests in test/ pass today, but passing them does not prove the code meets the specification. Make the codebase conform to SPEC.md, keeping everything that already conforms working. Run the tests with: node --import tsx --test test/. Do not create files outside this directory.`;

const d = (y: number, m: number, dd: number) => `{ y: ${y}, m: ${m}, d: ${dd} }`;
export function publicTests(inst: Instance): Files {
  const p = inst.params;
  const t: Files = {};
  t['money.test.ts'] = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { roundHalfUp, fmt, sum } from '../src/money.ts';\n
test('roundHalfUp positive', () => { assert.equal(roundHalfUp(2.5), 3); assert.equal(roundHalfUp(2.4), 2); assert.equal(roundHalfUp(0), 0); });
test('roundHalfUp negative non-tie', () => { assert.equal(roundHalfUp(-2.4), -2); assert.equal(roundHalfUp(-2.6), -3); });
test('fmt and sum', () => { assert.equal(fmt(1234), '12.34'); assert.equal(fmt(-5), '-0.05'); assert.equal(sum([1, 2, 3]), 6); });
`;
  t['calendar.test.ts'] = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { addDays, addMonths, daysBetween, daysInMonth } from '../src/calendar.ts';\n
test('daysInMonth', () => { assert.equal(daysInMonth(2024, 2), 29); assert.equal(daysInMonth(2025, 4), 30); });
test('addMonths mid month', () => { assert.deepEqual(addMonths(${d(2025, 1, 15)}, 1), ${d(2025, 2, 15)}); assert.deepEqual(addMonths(${d(2025, 11, 10)}, 3), ${d(2026, 2, 10)}); });
test('daysBetween and addDays', () => { assert.equal(daysBetween(${d(2025, 3, 1)}, ${d(2025, 3, 31)}), 30); assert.deepEqual(addDays(${d(2025, 2, 27)}, 3), ${d(2025, 3, 2)}); });
`;
  t['plans.test.ts'] = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { PLANS, usageCharge } from '../src/plans.ts';\n
test('usage inside first tier', () => { assert.equal(usageCharge(PLANS.starter, 10), 10 * ${p.pa}); assert.equal(usageCharge(PLANS.starter, 0), 0); });
test('usage just inside first tier', () => { assert.equal(usageCharge(PLANS.starter, ${p.tierA - 1}), ${p.tierA - 1} * ${p.pa}); });
`;
  t['proration.test.ts'] = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { prorate, prorateCredit, remainingShare } from '../src/proration.ts';\n
test('thirty day period', () => { assert.equal(remainingShare(${d(2025, 4, 1)}, ${d(2025, 5, 1)}, ${d(2025, 4, 16)}), 0.5); assert.equal(prorate(3000, ${d(2025, 4, 1)}, ${d(2025, 5, 1)}, ${d(2025, 4, 11)}), 2000); });
test('credit sign', () => { assert.equal(prorateCredit(3000, ${d(2025, 4, 1)}, ${d(2025, 5, 1)}, ${d(2025, 4, 11)}), -2000); });
`;
  t['coupons.test.ts'] = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { applyCoupons } from '../src/coupons.ts';\n
test('single percent', () => { assert.deepEqual(applyCoupons(10000, [{ code: 'A', kind: 'percent', value: 1000 }]), { discount: 1000, total: 9000 }); });
test('single fixed', () => { assert.deepEqual(applyCoupons(10000, [{ code: 'B', kind: 'fixed', value: 500 }]), { discount: 500, total: 9500 }); });
test('none', () => { assert.deepEqual(applyCoupons(10000, []), { discount: 0, total: 10000 }); });
`;
  t['tax.test.ts'] = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { taxFor } from '../src/tax.ts';\n
test('regions', () => { assert.equal(taxFor('Y', 10000), 0); assert.equal(taxFor('Z', 10000), 500); assert.equal(taxFor('X', 10000), ${p.taxBps}); assert.equal(taxFor('Q', 10000), 0); });
`;
  t['invoice.test.ts'] = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { buildInvoice } from '../src/invoice.ts';\n
const cust = { id: 'c1', region: 'X', taxExempt: false };
test('invoice without coupons', () => {
  const inv = buildInvoice({ customer: cust, planId: 'starter', units: 10 });
  assert.equal(inv.subtotal, ${p.base + 10 * p.pa});
  assert.equal(inv.discount, 0);
  assert.equal(inv.total, inv.subtotal + inv.tax);
});
test('untaxed region', () => { assert.equal(buildInvoice({ customer: { ...cust, region: 'Y' }, planId: 'starter', units: 1 }).tax, 0); });
`;
  t['dunning.test.ts'] = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { lateFee } from '../src/dunning.ts';\nimport { addDays } from '../src/calendar.ts';\n
const due = ${d(2025, 6, 1)};
test('no fee well inside the grace period', () => { assert.equal(lateFee(10000, due, addDays(due, 1)), 0); });
test('fee well past the grace period', () => { assert.equal(lateFee(10000, due, addDays(due, ${p.grace + 20})), Math.min(${Math.round(10000 * p.feeBps / 10000)}, ${p.feeCap})); });
${inst.defects.includes('D10') ? `test('fee applies once the grace period is used up', () => { assert.equal(lateFee(10000, due, addDays(due, ${p.grace})), ${Math.min(Math.round(10000 * p.feeBps / 10000), p.feeCap)}); });` : ''}
`;
  t['report.test.ts'] = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { isActive, mrr } from '../src/report.ts';\n
const subs = [
  { id: 's1', planId: 'starter', cycle: 'monthly' as const, cents: 5000, start: ${d(2025, 1, 10)} },
  { id: 's2', planId: 'growth', cycle: 'annual' as const, cents: 12000, start: ${d(2025, 2, 1)} },
];
test('mrr', () => { assert.equal(mrr(subs, ${d(2025, 3, 1)}), 6000); assert.equal(mrr(subs, ${d(2025, 1, 20)}), 5000); });
test('active before start and open ended', () => { assert.equal(isActive(subs[0], ${d(2025, 1, 9)}), false); assert.equal(isActive(subs[0], ${d(2030, 1, 9)}), true); });
`;
  return t;
}

const ORACLE_SCORE = `/** Private oracle for a generated planted-defect task. Never copied into public/.
 * node --import tsx oracle/score.ts WORKSPACE
 * Output: {score, oracle_results, defects_planted, defects_caught, defects_shipped, regressions_failed, caught_ids, missed_ids, regression_failed_ids}.
 * score is 1 only when every planted defect is fixed and no regression check fails. Exit 0 = score 1, 1 = otherwise, 2 = usage.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHECKS } from './checks.ts';

const workspace = process.argv[2];
if (!workspace) { console.error('usage: score.ts WORKSPACE'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8'));
const names = ['money', 'types', 'calendar', 'plans', 'proration', 'coupons', 'tax', 'invoice', 'dunning', 'report'];

const mods: Record<string, any> = {};
let loadError = '';
for (const n of names) {
  try { mods[n] = await import(pathToFileURL(resolve(workspace, 'src', n + '.ts')).href + '?t=' + Date.now()); }
  catch (e) { loadError = String(e); }
}
function run(id: string): boolean {
  if (loadError) return false;
  try { return JSON.stringify(CHECKS[id](mods, inst.params)) === JSON.stringify(expected[id]); }
  catch { return false; }
}
const oracle_results: { name: string; exit_code: number }[] = [];
const caught_ids: string[] = [], missed_ids: string[] = [], regression_failed_ids: string[] = [];
for (const id of inst.defects) { const ok = run(id); oracle_results.push({ name: 'defect/' + id, exit_code: ok ? 0 : 1 }); (ok ? caught_ids : missed_ids).push(id); }
for (const id of Object.keys(CHECKS).filter((k) => k.startsWith('R'))) { const ok = run(id); oracle_results.push({ name: 'regression/' + id, exit_code: ok ? 0 : 1 }); if (!ok) regression_failed_ids.push(id); }
const score = missed_ids.length === 0 && regression_failed_ids.length === 0 ? 1 : 0;
console.log(JSON.stringify({
  score, oracle_results, defects_planted: inst.defects.length, defects_caught: caught_ids.length,
  defects_shipped: missed_ids.length + regression_failed_ids.length, regressions_failed: regression_failed_ids.length,
  caught_ids, missed_ids, regression_failed_ids,
}));
process.exit(score === 1 ? 0 : 1);
`;

const ORACLE_CHECKS = `/** Hidden checks: D* = one per defect (passes only if that defect is fixed); R* = regression behaviours that hold
 * in the original code. Expected values are frozen from the correct build into expected.json. */
const d = (y: number, m: number, dd: number) => ({ y, m, d: dd });
export const CHECKS: Record<string, (m: any, p: any) => unknown> = {
  D01: (m) => [m.money.roundHalfUp(-2.5), m.money.roundHalfUp(-0.5), m.money.roundHalfUp(-1234.5)],
  D02: (m) => [m.calendar.addMonths(d(2025, 1, 31), 1), m.calendar.addMonths(d(2024, 1, 31), 1), m.calendar.addMonths(d(2025, 8, 31), 6)],
  D03: (m, p) => [m.plans.usageCharge(m.plans.PLANS.starter, p.tierA + 1), m.plans.usageCharge(m.plans.PLANS.starter, p.tierB + 7), m.plans.usageCharge(m.plans.PLANS.growth, p.tierA * 2 + 3)],
  D04: (m, p) => [m.proration.prorate(4999, d(2025, 3, 1), d(2025, 4, 1), d(2025, 3, 11)), m.proration.remainingShare(d(2025, 2, 1), d(2025, 3, 1), d(2025, 2, 15))],
  D05: (m) => [m.coupons.applyCoupons(10000, [{ code: 'F', kind: 'fixed', value: 500 }, { code: 'P', kind: 'percent', value: 1000 }])],
  D06: (m) => [m.coupons.applyCoupons(3000, [{ code: 'F', kind: 'fixed', value: 5000 }]), m.coupons.applyCoupons(3000, [{ code: 'P', kind: 'percent', value: 4000 }, { code: 'F', kind: 'fixed', value: 2500 }])],
  D07: (m) => [m.coupons.applyCoupons(10000, [{ code: 'P', kind: 'percent', value: 5000, maxCents: 1000 }])],
  D08: (m) => [m.invoice.buildInvoice({ customer: { id: 'c', region: 'X', taxExempt: false }, planId: 'starter', units: 30, coupons: [{ code: 'F', kind: 'fixed', value: 1000 }] })],
  D09: (m) => [m.invoice.buildInvoice({ customer: { id: 'c', region: 'X', taxExempt: true }, planId: 'growth', units: 12 }).tax],
  D10: (m, p) => [m.dunning.lateFee(20000, d(2025, 6, 1), m.calendar.addDays(d(2025, 6, 1), p.grace)), m.dunning.lateFee(20000, d(2025, 6, 1), m.calendar.addDays(d(2025, 6, 1), p.grace + 1))],
  D11: (m) => { const s = { id: 's', planId: 'starter', cycle: 'monthly', cents: 5000, start: d(2025, 1, 1), end: d(2025, 4, 1) }; return [m.report.isActive(s, d(2025, 3, 31)), m.report.isActive(s, d(2025, 4, 1)), m.report.mrr([s], d(2025, 4, 1))]; },
  D12: (m) => [m.report.monthlyValue({ id: 's', planId: 'growth', cycle: 'annual', cents: 10007, start: d(2025, 1, 1) }), m.report.mrr([{ id: 'a', planId: 'growth', cycle: 'annual', cents: 20011, start: d(2025, 1, 1) }], d(2025, 2, 1))],
  R01: (m) => [m.money.roundHalfUp(2.5), m.money.roundHalfUp(-2.4), m.money.roundHalfUp(-2.6), m.money.fmt(-1999), m.money.sum([5, 6])],
  R02: (m) => [m.calendar.addMonths(d(2025, 1, 15), 13), m.calendar.addMonths(d(2025, 3, 30), 1), m.calendar.addMonths(d(2025, 12, 5), 1), m.calendar.addMonths(d(2025, 3, 10), -3)],
  R03: (m) => [m.calendar.daysBetween(d(2024, 2, 1), d(2024, 3, 1)), m.calendar.addDays(d(2024, 2, 28), 2), m.calendar.daysInMonth(2100, 2)],
  R04: (m, p) => [m.plans.usageCharge(m.plans.PLANS.starter, 0), m.plans.usageCharge(m.plans.PLANS.starter, 7), m.plans.usageCharge(m.plans.PLANS.growth, 5), m.plans.usageCharge(m.plans.PLANS.starter, p.tierA - 1)],
  R05: (m) => [m.proration.prorate(3000, d(2025, 4, 1), d(2025, 5, 1), d(2025, 4, 11)), m.proration.prorateCredit(3000, d(2025, 4, 1), d(2025, 5, 1), d(2025, 4, 11)), m.proration.prorate(3000, d(2025, 4, 1), d(2025, 5, 1), d(2025, 5, 1))],
  R06: (m) => [m.coupons.applyCoupons(10000, [{ code: 'P', kind: 'percent', value: 1500 }]), m.coupons.applyCoupons(8000, [{ code: 'F', kind: 'fixed', value: 700 }]), m.coupons.applyCoupons(500, [])],
  R07: (m) => [m.coupons.applyCoupons(10000, [{ code: 'A', kind: 'percent', value: 1000 }, { code: 'B', kind: 'percent', value: 500 }]), m.coupons.applyCoupons(10000, [{ code: 'P', kind: 'percent', value: 2000, maxCents: 5000 }])],
  R08: (m) => [m.tax.taxFor('X', 12345), m.tax.taxFor('Z', 999), m.tax.taxFor('Y', 5000), m.tax.taxFor('?', 5000)],
  R09: (m) => [m.invoice.buildInvoice({ customer: { id: 'c', region: 'Y', taxExempt: false }, planId: 'starter', units: 5 }), m.invoice.buildInvoice({ customer: { id: 'c', region: 'Z', taxExempt: false }, planId: 'growth', units: 3 })],
  R10: (m, p) => [m.dunning.lateFee(10000, d(2025, 6, 1), m.calendar.addDays(d(2025, 6, 1), 2)), m.dunning.lateFee(10000, d(2025, 6, 1), m.calendar.addDays(d(2025, 6, 1), p.grace + 30)), m.dunning.lateFee(9999999, d(2025, 6, 1), m.calendar.addDays(d(2025, 6, 1), p.grace + 30))],
  R11: (m) => { const s = { id: 's', planId: 'starter', cycle: 'monthly', cents: 5000, start: d(2025, 1, 10) }; return [m.report.isActive(s, d(2025, 1, 9)), m.report.isActive(s, d(2025, 1, 10)), m.report.isActive(s, d(2031, 1, 1))]; },
  R12: (m) => [m.report.mrr([{ id: 'a', planId: 'growth', cycle: 'annual', cents: 12000, start: d(2025, 1, 1) }, { id: 'b', planId: 'starter', cycle: 'monthly', cents: 4999, start: d(2025, 1, 1) }], d(2025, 6, 1))],
};
`;

export async function writeTask(seed: number, out: string): Promise<Instance> {
  const inst = deriveInstance(seed);
  const id = out.split('/').pop()!;
  const w = (rel: string, body: string) => { const f = join(out, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); };
  const all = new Set<string>(inst.defects);
  for (const [f, body] of Object.entries(buildSrc(inst, new Set()))) { w(`public/src/${f}`, body); w(`fixtures/broken/src/${f}`, body); }
  for (const [f, body] of Object.entries(buildSrc(inst, all))) w(`fixtures/correct/src/${f}`, body);
  for (const [f, body] of Object.entries(publicTests(inst))) w(`public/test/${f}`, body);
  w('public/SPEC.md', SPEC(inst.params));
  w('public/brief.txt', BRIEF + '\n');
  w('task.json', JSON.stringify({ task_id: id }) + '\n');
  w('oracle/oracle.json', JSON.stringify({ kind: 'planted-defects' }) + '\n');
  w('oracle/instance.json', JSON.stringify(inst, null, 2) + '\n');
  w('oracle/DEFECTS.json', JSON.stringify(inst.defects.map((k) => ({ id: k, module: DEFECT_MODULE[k], kind: DEFECT_KIND[k] })), null, 2) + '\n');
  w('oracle/checks.ts', ORACLE_CHECKS);
  w('oracle/score.ts', ORACLE_SCORE);
  const { CHECKS } = await import(pathToFileURL(resolve(out, 'oracle/checks.ts')).href + '?t=' + Date.now());
  const mods: Record<string, any> = {};
  for (const n of ['money', 'types', 'calendar', 'plans', 'proration', 'coupons', 'tax', 'invoice', 'dunning', 'report']) mods[n] = await import(pathToFileURL(resolve(out, 'fixtures/correct/src', n + '.ts')).href);
  const expected: Record<string, unknown> = {};
  for (const k of Object.keys(CHECKS)) expected[k] = JSON.parse(JSON.stringify(CHECKS[k](mods, inst.params)));
  w('oracle/expected.json', JSON.stringify(expected, null, 2) + '\n');
  w('README.md', `# ${id}\n\nGenerated by scripts/bench-build-gen.ts (seed ${seed}). Only public/ is copied into a seat's workspace.\nPlanted defects: ${inst.defects.join(', ')} (see oracle/DEFECTS.json; never shown to an arm).\nScore: oracle/score.ts prints defects_caught and defects_shipped besides the 0/1 score.\n`);
  return inst;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const seed = Number(process.argv[2]);
  if (!Number.isInteger(seed)) { console.error('usage: bench-build-gen.ts <seed> [--out dir]'); process.exit(2); }
  const oi = process.argv.indexOf('--out');
  const out = resolve(oi > 0 ? process.argv[oi + 1] : `tasks/build-billing-s${seed}`);
  writeTask(seed, out).then((i) => console.log(JSON.stringify(i)));
}
