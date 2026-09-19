/** Private deterministic artifact oracle for complementary-fix. Never copied into public/.
 * node --import tsx tasks/complementary-fix/oracle/score.ts WORKSPACE
 * exit 0: all pass; exit 1: artifact/case failure; exit 2: invocation error.
 * Path separation is not a sandbox. Run untrusted code in a restricted process.
 *
 * Two independent invariant groups (merge, tier) are scored and reported
 * separately so a design audit can tell whether a candidate fixed neither,
 * one, or both bugs -- this detail is never surfaced to an agent or seat,
 * only to the harness's own result.json.
 */
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = process.argv[2];
if (!workspace) {
  console.error('usage: score.ts WORKSPACE');
  process.exit(2);
}

type Case = { group: 'merge' | 'tier'; name: string; run: (mod: any) => void };

const cases: Case[] = [
  {
    group: 'merge', name: 'touching-intervals-merge', run: (m) => {
      assert.deepEqual(m.mergeIntervals([{ start: 1, end: 5 }, { start: 5, end: 9 }]), [{ start: 1, end: 9 }]);
    },
  },
  {
    group: 'merge', name: 'overlapping-intervals-merge', run: (m) => {
      assert.deepEqual(m.mergeIntervals([{ start: 1, end: 6 }, { start: 4, end: 9 }]), [{ start: 1, end: 9 }]);
    },
  },
  {
    group: 'merge', name: 'disjoint-intervals-stay-separate', run: (m) => {
      assert.deepEqual(m.mergeIntervals([{ start: 1, end: 4 }, { start: 6, end: 9 }]), [{ start: 1, end: 4 }, { start: 6, end: 9 }]);
    },
  },
  {
    group: 'merge', name: 'unsorted-input-three-way-chain', run: (m) => {
      assert.deepEqual(
        m.mergeIntervals([{ start: 10, end: 15 }, { start: 0, end: 5 }, { start: 5, end: 10 }]),
        [{ start: 0, end: 15 }],
      );
    },
  },
  {
    group: 'merge', name: 'single-interval-unchanged', run: (m) => {
      assert.deepEqual(m.mergeIntervals([{ start: 2, end: 3 }]), [{ start: 2, end: 3 }]);
    },
  },
  {
    group: 'tier', name: 'exact-threshold-gets-tier', run: (m) => {
      assert.equal(m.tierRate(10, [{ min: 0, rate: 1 }, { min: 10, rate: 2 }, { min: 100, rate: 3 }]), 2);
    },
  },
  {
    group: 'tier', name: 'below-threshold-keeps-lower-tier', run: (m) => {
      assert.equal(m.tierRate(9, [{ min: 0, rate: 1 }, { min: 10, rate: 2 }, { min: 100, rate: 3 }]), 1);
    },
  },
  {
    group: 'tier', name: 'exact-top-threshold-gets-top-tier', run: (m) => {
      assert.equal(m.tierRate(100, [{ min: 0, rate: 1 }, { min: 10, rate: 2 }, { min: 100, rate: 3 }]), 3);
    },
  },
  {
    group: 'tier', name: 'below-first-tier-uses-first-rate', run: (m) => {
      assert.equal(m.tierRate(-5, [{ min: 0, rate: 1 }, { min: 10, rate: 2 }]), 1);
    },
  },
  {
    group: 'tier', name: 'above-all-thresholds-uses-last-tier', run: (m) => {
      assert.equal(m.tierRate(101, [{ min: 0, rate: 1 }, { min: 10, rate: 2 }, { min: 100, rate: 3 }]), 3);
    },
  },
];

const oracle_results: { group: string; name: string; exit_code: number }[] = [];
try {
  const mod = await import(pathToFileURL(join(resolve(workspace), 'scheduling.ts')).href);
  for (const c of cases) {
    try {
      c.run(mod);
      oracle_results.push({ group: c.group, name: c.name, exit_code: 0 });
    } catch {
      oracle_results.push({ group: c.group, name: c.name, exit_code: 1 });
    }
  }
} catch {
  for (const c of cases) oracle_results.push({ group: c.group, name: c.name, exit_code: 1 });
}

const groups = ['merge', 'tier'] as const;
const group_results = Object.fromEntries(
  groups.map((g) => [g, oracle_results.filter((r) => r.group === g).every((r) => r.exit_code === 0)]),
);
const score = Number(oracle_results.length === cases.length && oracle_results.every((r) => r.exit_code === 0));
console.log(JSON.stringify({ score, group_results, oracle_results }));
process.exit(score === 1 ? 0 : 1);
