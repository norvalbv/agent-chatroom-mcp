/** Private deterministic artifact oracle for bench-refactor-preserve.
 * node --import tsx tasks/bench-refactor-preserve/oracle/score.ts WORKSPACE
 * exit 0: all pass; exit 1: artifact failure; exit 2: invocation error.
 * Path separation is not a sandbox. Run untrusted code in a restricted process.
 */
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const workspace = process.argv[2];
if (!workspace) {
  console.error('usage: score.ts WORKSPACE');
  process.exit(2);
}
type Item = { qty: number; unitPrice: number };
// Three items whose per-line-rounded sum (0.13*3=0.39) differs from rounding the
// raw summed value once (0.375 -> 0.38): distinguishes "round per line, then sum"
// (required) from "sum raw, round once" (the tempting simplification).
const trap: Item[] = [{ qty: 1, unitPrice: 0.125 }, { qty: 1, unitPrice: 0.125 }, { qty: 1, unitPrice: 0.125 }];

const subtotalCases: { name: string; items: Item[]; expected?: number }[] = [
  { name: 'single-item', items: [{ qty: 2, unitPrice: 3.333 }], expected: 6.67 },
  { name: 'empty', items: [], expected: 0 },
  { name: 'rounding-order-trap', items: trap, expected: 0.39 },
  { name: 'negative-qty-throws', items: [{ qty: -1, unitPrice: 5 }] },
];
const invoiceCases: { name: string; items: Item[]; taxRate: number; expected?: number }[] = [
  { name: 'basic-tax', items: [{ qty: 2, unitPrice: 10 }], taxRate: 0.1, expected: 22 },
  { name: 'rounding-order-trap-zero-tax', items: trap, taxRate: 0, expected: 0.39 },
  { name: 'negative-qty-throws', items: [{ qty: -1, unitPrice: 5 }], taxRate: 0.1 },
];

const oracle_results: { name: string; exit_code: number }[] = [];
try {
  const mod = await import(pathToFileURL(join(resolve(workspace), 'invoice.ts')).href);
  const { computeSubtotal, computeInvoiceTotal } = mod;
  assert.equal(typeof computeSubtotal, 'function');
  assert.equal(typeof computeInvoiceTotal, 'function');
  for (const c of subtotalCases) {
    try {
      if (c.expected !== undefined) assert.equal(computeSubtotal(c.items), c.expected);
      else assert.throws(() => computeSubtotal(c.items), { message: 'invalid quantity' });
      oracle_results.push({ name: `subtotal-${c.name}`, exit_code: 0 });
    } catch { oracle_results.push({ name: `subtotal-${c.name}`, exit_code: 1 }); }
  }
  for (const c of invoiceCases) {
    try {
      if (c.expected !== undefined) assert.equal(computeInvoiceTotal(c.items, c.taxRate), c.expected);
      else assert.throws(() => computeInvoiceTotal(c.items, c.taxRate), { message: 'invalid quantity' });
      oracle_results.push({ name: `invoice-${c.name}`, exit_code: 0 });
    } catch { oracle_results.push({ name: `invoice-${c.name}`, exit_code: 1 }); }
  }
} catch {
  oracle_results.push({ name: 'artifact-load', exit_code: 1 });
}
const totalCases = subtotalCases.length + invoiceCases.length;
const score = Number(oracle_results.length === totalCases && oracle_results.every(r => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exit(score === 1 ? 0 : 1);
