/** Regression tests for bench-refactor-preserve and bench-concurrency-order (sonnet-6, swarm-140131-j6yf).
 * Run: node --import tsx --test scripts/oracle-tasks-refactor-concurrency.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';

const refactor = resolve('tasks/bench-refactor-preserve');
const order = resolve('tasks/bench-concurrency-order');

function temporary() { return mkdtempSync(join(tmpdir(), 'oracle-tasks-')); }
function invoke(script: string, args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { encoding: 'utf8', timeout: 15000 });
}
function workspace(taskDir: string) {
  const dir = temporary();
  cpSync(join(taskDir, 'public'), dir, { recursive: true });
  assert.equal(existsSync(join(dir, 'oracle')), false);
  return dir;
}

// --- bench-refactor-preserve ---

test('refactor-preserve: kind dispatches to generic private-test scorer', () => {
  assert.equal(loadTask(refactor).oracle.kind, 'refactor-preserve');
});

test('refactor-preserve: unmodified buggy baseline (sum-then-round-once, no-op submission) fails the rounding-order trap cases', () => {
  // Regression for sonnet-3's admission attack: the starting code must itself be wrong (sum raw,
  // round once) so a seat that never touches invoice.ts cannot pass by construction.
  const dir = workspace(refactor);
  try {
    const run = invoke(join(refactor, 'oracle/score.ts'), [dir]);
    assert.equal(run.status, 1);
    const result = JSON.parse(run.stdout);
    assert.equal(result.score, 0);
    assert.ok(result.oracle_results.some((r: any) => r.name === 'subtotal-rounding-order-trap' && r.exit_code === 1));
    assert.ok(result.oracle_results.some((r: any) => r.name === 'invoice-rounding-order-trap-zero-tax' && r.exit_code === 1));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('refactor-preserve: correctly extracted helper (round-per-line-then-sum preserved) passes', () => {
  const dir = workspace(refactor);
  try {
    writeFileSync(join(dir, 'invoice.ts'), `export type LineItem = { qty: number; unitPrice: number };
function roundCents(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function sumRoundedLines(items) {
  let total = 0;
  for (const item of items) { if (item.qty < 0) throw new Error('invalid quantity'); total += roundCents(item.qty * item.unitPrice); }
  return roundCents(total);
}
export function computeSubtotal(items) { return sumRoundedLines(items); }
export function computeInvoiceTotal(items, taxRate) {
  const subtotal = sumRoundedLines(items);
  const tax = roundCents(subtotal * taxRate);
  return roundCents(subtotal + tax);
}
`);
    const run = invoke(join(refactor, 'oracle/score.ts'), [dir]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).score, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('refactor-preserve: missing artifact => parse_failure via scoreTask, not task_fail', async () => {
  const dir = workspace(refactor);
  try {
    rmSync(join(dir, 'invoice.ts'), { force: true });
    const scored = await scoreTask(refactor, dir);
    assert.equal(scored.passed, false);
    assert.equal(scored.reason, 'parse_failure');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- bench-concurrency-order ---

test('concurrency-order: kind dispatches to generic private-test scorer', () => {
  assert.equal(loadTask(order).oracle.kind, 'concurrency-order');
});

test('concurrency-order: unmodified baseline (array-order bug) fails the reordering cases', () => {
  const dir = workspace(order);
  try {
    const run = invoke(join(order, 'oracle/score.ts'), [dir]);
    assert.equal(run.status, 1);
    const result = JSON.parse(run.stdout);
    assert.equal(result.score, 0);
    assert.ok(result.oracle_results.some((r: any) => r.name === 'set-out-of-order-same-key' && r.exit_code === 1));
    assert.ok(result.oracle_results.some((r: any) => r.name === 'delete-arrives-before-its-earlier-set' && r.exit_code === 1));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('concurrency-order: sort-by-seq-before-apply fix passes all cases', () => {
  const dir = workspace(order);
  try {
    writeFileSync(join(dir, 'queue.ts'), `export function applyUpdates(events) {
  const state = {};
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const ev of ordered) { if (ev.op === 'set') state[ev.key] = ev.value ?? ''; else delete state[ev.key]; }
  return state;
}
`);
    const run = invoke(join(order, 'oracle/score.ts'), [dir]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).score, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('concurrency-order: loadTask/scoreTask dispatch and repeat deterministically', async () => {
  const dir = workspace(order);
  try {
    writeFileSync(join(dir, 'queue.ts'), `export function applyUpdates(events) {
  const state = {};
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const ev of ordered) { if (ev.op === 'set') state[ev.key] = ev.value ?? ''; else delete state[ev.key]; }
  return state;
}
`);
    const a = await scoreTask(order, dir), b = await scoreTask(order, dir);
    assert.equal(a.passed, true);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
