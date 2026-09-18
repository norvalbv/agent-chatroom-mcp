/**
 * RQ1 harness item 3 (swarm-120129-s12h, claim/usage-budget): arm A budget matching. (Item 2, per-run
 * result recording, is fulfilled directly by scripts/bench-rq1.ts's own result.json assembly — see board
 * key `result-schema` — so nothing here duplicates that.)
 */

/** Outcomes that void comparability (bench-bench.ts's own rule, matching protocol.md §4: task_fail and
 * parse_failure stay comparable — they are measured failures, not voided runs). Exported so a reader of
 * scripts/bench-rq1.ts's result.json (item 5's table/grid scripts) derives `comparable` from `outcome`
 * the same way everywhere, instead of each consumer re-declaring this set. */
const NOT_COMPARABLE = new Set(["timeout", "infrastructure_error", "tamper"]);
export function isComparable(outcome: string): boolean {
  return !NOT_COMPARABLE.has(outcome);
}

/**
 * Arm A budget matching (protocol §2.1/§6, "matched" defined precisely here — see paper/amendments.md):
 * --max-budget-usd is set to arm C's realized total `cost_usd` on the exact same (task, seed) — a paired,
 * within-task, within-seed match computed post hoc from arm C's own result, not a single number reused
 * across tasks or seeds. The wall-clock cap is arm C's realized wall-clock duration on that same run,
 * because the claude CLI offers no turn-ceiling flag (`claude --help`: only `--max-budget-usd` exists, and
 * only for `--print`/`-p` mode; no `--max-turns`/`--max-tokens`).
 */
export function matchArmABudget(armC: { costUsd: number; wallClockMs: number }): { maxBudgetUsd: number; wallClockCapMs: number } {
  if (!(armC.costUsd > 0)) throw new Error("matchArmABudget: arm C cost_usd must be a positive measured spend to derive arm A's budget from");
  if (!(armC.wallClockMs > 0)) throw new Error("matchArmABudget: arm C wall-clock duration must be positive to derive arm A's cap from");
  return { maxBudgetUsd: armC.costUsd, wallClockCapMs: armC.wallClockMs };
}
