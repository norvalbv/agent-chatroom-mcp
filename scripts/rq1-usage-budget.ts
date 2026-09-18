/**
 * RQ1 harness items 2+3 (swarm-120129-s12h, claim/usage-budget): per-run result recording and arm A
 * budget matching. Shape pinned with sonnet-2 (item 5, RQ1 table/grid reader) and sonnet-3 (item 1,
 * harness mode): bench/results/rq1/<task>-<arm>-seed<seed>.json.
 */
import type { SeatUsageRollup, UsageRollup } from "../src/result.js";
import { rollupUsage } from "../src/result.js";

export interface RQ1SeatUsage {
  name: string;
  usage: SeatUsageRollup | null;
}

export interface RQ1RunResult {
  schemaVersion: 1;
  task: string;
  arm: "A" | "C";
  seed: number;
  model: string;
  outcome: string;
  /** Matches bench-bench.ts's own comparability rule: excludes exactly timeout/infrastructure_error/tamper. */
  comparable: boolean;
  usage: {
    per_seat: Array<{ name: string } & Partial<SeatUsageRollup>>;
    summed: UsageRollup;
  };
  turns: { value: number; approximated: boolean };
  wall_clock: { started_at: string; completed_at: string };
  build: {
    hub_entry_sha256: string | null;
    hub_build_sha256: string | null;
    hub_revision: string | null;
    task_sha256: string;
    scorer_sha256: string;
  };
  argv: string[];
}

/** Outcomes that void comparability (bench-bench.ts's own rule; task_fail/parse_failure stay comparable —
 * they are measured failures, not voided runs). */
const NOT_COMPARABLE = new Set(["timeout", "infrastructure_error", "tamper"]);

const EMPTY_ROLLUP: UsageRollup = { steps: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, seats: 0, seats_with_usage: 0, coverage: "none" };

export function buildRunResult(params: {
  task: string;
  arm: "A" | "C";
  seed: number;
  model: string;
  outcome: string;
  seats: RQ1SeatUsage[];
  turns: { value: number; approximated: boolean };
  startedAt: string;
  completedAt: string;
  build: RQ1RunResult["build"];
  argv: string[];
}): RQ1RunResult {
  const summed = rollupUsage(params.seats.map((s) => ({ usage: s.usage }))) ?? EMPTY_ROLLUP;
  return {
    schemaVersion: 1,
    task: params.task,
    arm: params.arm,
    seed: params.seed,
    model: params.model,
    outcome: params.outcome,
    comparable: !NOT_COMPARABLE.has(params.outcome),
    usage: {
      per_seat: params.seats.map((s) => ({ name: s.name, ...(s.usage ?? {}) })),
      summed,
    },
    turns: params.turns,
    wall_clock: { started_at: params.startedAt, completed_at: params.completedAt },
    build: params.build,
    argv: params.argv,
  };
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
