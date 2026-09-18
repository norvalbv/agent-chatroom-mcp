/** Private deterministic artifact oracle for bench-concurrency-order.
 * node --import tsx tasks/bench-concurrency-order/oracle/score.ts WORKSPACE
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
type Event = { seq: number; op: 'set' | 'delete'; key: string; value?: string };
const cases: { name: string; events: Event[]; expected: Record<string, string> }[] = [
  {
    name: 'already-in-order',
    events: [{ seq: 1, op: 'set', key: 'a', value: 'v1' }, { seq: 2, op: 'set', key: 'a', value: 'v2' }],
    expected: { a: 'v2' },
  },
  {
    name: 'set-out-of-order-same-key',
    // array order is v2 then v1; chronological (seq) order is v1 then v2, so v2 wins.
    events: [{ seq: 2, op: 'set', key: 'a', value: 'v2' }, { seq: 1, op: 'set', key: 'a', value: 'v1' }],
    expected: { a: 'v2' },
  },
  {
    name: 'delete-arrives-before-its-earlier-set',
    // array order: delete(seq5) then set(seq1); chronologically set(1) happens, then delete(5) removes it.
    events: [{ seq: 5, op: 'delete', key: 'b' }, { seq: 1, op: 'set', key: 'b', value: 'x' }],
    expected: {},
  },
  {
    name: 'multi-key-interleaved-reorder',
    // array order x=3,y=1,x=2; seq order y=1(seq1), x=2(seq2), x=3(seq3) -> final x should be '3'.
    events: [
      { seq: 3, op: 'set', key: 'x', value: '3' },
      { seq: 1, op: 'set', key: 'y', value: '1' },
      { seq: 2, op: 'set', key: 'x', value: '2' },
    ],
    expected: { x: '3', y: '1' },
  },
  {
    name: 'delete-of-never-set-key',
    events: [{ seq: 1, op: 'delete', key: 'z' }],
    expected: {},
  },
  {
    name: 'set-then-earlier-delete-arrives-late',
    // array order: set(seq1) then delete(seq2 arriving last in array but still later in seq); should delete win.
    events: [{ seq: 1, op: 'set', key: 'c', value: 'y' }, { seq: 2, op: 'delete', key: 'c' }],
    expected: {},
  },
  {
    name: 'value-omitted-defaults-empty-string',
    events: [{ seq: 1, op: 'set', key: 'd' }],
    expected: { d: '' },
  },
];

const oracle_results: { name: string; exit_code: number }[] = [];
try {
  const mod = await import(pathToFileURL(join(resolve(workspace), 'queue.ts')).href);
  const { applyUpdates } = mod;
  assert.equal(typeof applyUpdates, 'function');
  for (const c of cases) {
    try {
      assert.deepEqual(applyUpdates(c.events), c.expected);
      oracle_results.push({ name: c.name, exit_code: 0 });
    } catch { oracle_results.push({ name: c.name, exit_code: 1 }); }
  }
} catch {
  oracle_results.push({ name: 'artifact-load', exit_code: 1 });
}
const score = Number(oracle_results.length === cases.length && oracle_results.every(r => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exit(score === 1 ? 0 : 1);
