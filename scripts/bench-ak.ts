/** Arm K (paper/amendments.md, "Arm K, settled definition"): k independent, unmodified arm-A attempts (the
 * exact scripts/bench-rq1.ts arm-A path) for one (task, seed), then ONE attempt submitted by an oracle-free
 * selector. The submitted attempt's score is the unchanged oracle's score for it; cost and turns are summed
 * over all k attempts.
 *
 * node --import tsx scripts/bench-ak.ts TASK_DIR K SEED --root DIR --arm-c-result PATH [--model sonnet]
 *   [--runner scripts/bench-rq1.ts] [--concurrency 4] [--attempt-cap-usd N] [--attempt-deadline-ms N] [--resume]
 *
 * Selectors (scripts/ak-select.ts; chosen by the task's oracle kind, never by looking at an oracle result):
 *   exact-answer -> plurality of normalized answers (self-consistency, arXiv:2203.11171)
 *   printf-format -> MBR-exec execution agreement (arXiv:2204.11454) on probes generated from the public README
 *     grammar (primary), plurality of whole execution signatures (CodeT agreement classes, arXiv:2207.10397)
 *     reported alongside as exploratory only
 * A task with no selector is refused. The selectors read only each attempt's workspace files and the task's
 * public grammar; they never open oracle/ or fixtures/ (the scoring runs are separate and happen inside each attempt).
 *
 * Attempts are sub-seeded seed*1000+i and run --concurrency at a time, each in its own process group so a
 * SIGINT/SIGTERM/exit of this script kills every runner and the claude under it. An attempt killed by its cap or
 * deadline stays in the group as a null vote; its cost is counted when known and otherwise bounded by the cap,
 * never summed as zero.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { printfProbes, runCandidate, selectByMbrExec, selectBySignaturePlurality, type Signature } from "./ak-select.js";

const here = dirname(fileURLToPath(import.meta.url));
export const normalize = (s: string) => s.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();

/** Flat defaults settled in paper/amendments.md ("Arm K, settled definition"): observed arm-A maxima were
 * 0.104 USD and 48 s, so 0.30 USD / 150 s leave about 3x headroom and are not expected to bind. They are a
 * runaway rail, not the matching mechanism — matching is judged post hoc on realized per-seed spend. */
export const DEFAULT_ATTEMPT_CAP_USD = 0.3;
export const DEFAULT_ATTEMPT_DEADLINE_MS = 150000;

/** oracle.kind -> selector name; a kind with none here is refused rather than picked arbitrarily. */
const SELECTOR_BY_KIND: Record<string, "plurality" | "mbr-exec"> = { "exact-answer": "plurality", "printf-format": "mbr-exec" };

interface AttemptResult {
  outcome: string;
  passed: boolean;
  reason: string;
  oracle: unknown;
  usage: { cost_usd?: number; coverage?: string } | null;
  turns: { summed: number };
  wall_clock: { duration_ms: number };
  seats?: { exit_code: number | null; signal: string | null; killed_by_deadline: boolean }[];
}

// Children die with the parent: each runner leads its own process group (so the claude under it dies too).
const trackedGroups = new Set<ChildProcess>();
function killGroup(child: ChildProcess, sig: NodeJS.Signals) {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, sig);
    } catch {}
  }
}
process.on("exit", () => {
  for (const c of trackedGroups) killGroup(c, "SIGKILL");
});
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

const readAnswer = (root: string): string | null => {
  const p = join(root, "workspace", "answer.txt");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

function readResult(root: string): AttemptResult | null {
  try {
    return JSON.parse(readFileSync(join(root, "result.json"), "utf8")) as AttemptResult;
  } catch {
    return null;
  }
}

/** Self-consistency (arXiv:2203.11171) over final answers: plurality of normalized answers; ties, and the
 * no-answer case, break to the lowest attempt index (deterministic, not random). */
export function selectByMajorityVote(answers: (string | null)[]): { winnerIndex: number; normalized: (string | null)[]; votes: Record<string, number> } {
  const normalized = answers.map((a) => (a === null ? null : normalize(a)));
  const votes: Record<string, number> = {};
  for (const n of normalized) if (n !== null) votes[n] = (votes[n] ?? 0) + 1;
  let bestKey: string | null = null;
  let bestCount = -1;
  for (const [key, count] of Object.entries(votes)) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  const winnerIndex = bestKey === null ? 0 : normalized.findIndex((n) => n === bestKey);
  return { winnerIndex: winnerIndex < 0 ? 0 : winnerIndex, normalized, votes };
}

/** Runs scripts/ak-select.ts's MBR-exec (primary) and signature-plurality (exploratory) selectors over one
 * attempt per candidate workspace. Candidate paths only, never a task directory or a result.json: selection
 * never sees which attempt the oracle scored as a pass (opus-reviewer, oracle-leak hazard (b)). */
function selectPrintf(attemptWorkspaces: (string | null)[]) {
  const probes = printfProbes();
  const sigs: Signature[] = attemptWorkspaces.map((w) => (w && existsSync(join(w, "format.ts")) ? runCandidate(w, probes) : null));
  const primary = selectByMbrExec(sigs);
  const secondary = selectBySignaturePlurality(sigs);
  // Distinct signatures (identical full output vectors) form the vote clusters reported per group.
  const clusters: Record<string, number> = {};
  sigs.forEach((s) => {
    if (!s) {
      clusters["(none)"] = (clusters["(none)"] ?? 0) + 1;
      return;
    }
    const key = `c${sigs.findIndex((o) => o !== null && o.every((v, x) => v === s[x])) + 1}`;
    clusters[key] = (clusters[key] ?? 0) + 1;
  });
  return { winnerIndex: primary.winnerIndex, scores: primary.scores, loaded: sigs.map((s) => s !== null), votes: clusters, n_probes: probes.length, secondary: { rule: secondary.rule, winner_attempt: secondary.winnerIndex + 1, scores: secondary.scores } };
}

function runAttempt(runnerPath: string, args: string[]): Promise<{ status: number | null; stderr: string }> {
  return new Promise((res) => {
    const child = spawn(process.execPath, ["--import", "tsx", runnerPath, ...args], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
    trackedGroups.add(child);
    let err = "";
    child.stderr?.on("data", (d) => (err = (err + d).slice(-4000)));
    child.on("close", (status) => {
      trackedGroups.delete(child);
      killGroup(child, "SIGKILL"); // nothing of a finished attempt may outlive it
      res({ status, stderr: err });
    });
    child.on("error", (e) => {
      trackedGroups.delete(child);
      res({ status: null, stderr: String(e) });
    });
  });
}

/** Run `count` jobs with at most `limit` in flight. */
export async function pool(count: number, limit: number, job: (i: number) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < count) await job(next++);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, count)) }, worker));
}

async function main() {
  const argv = process.argv.slice(2);
  const taskArg = argv.shift();
  const kArg = argv.shift();
  const seedArg = argv.shift();
  if (!taskArg || !kArg || seedArg === undefined) {
    throw new Error("Usage: bench-ak.ts TASK_DIR K SEED --root DIR --arm-c-result PATH [--model sonnet] [--runner PATH] [--concurrency N] [--attempt-cap-usd N] [--attempt-deadline-ms N] [--resume]");
  }
  const k = Number(kArg);
  if (!Number.isInteger(k) || k < 2) throw new Error(`Invalid K (must be an integer >= 2): ${kArg}`);
  const seed = Number(seedArg);
  if (!Number.isInteger(seed)) throw new Error(`Invalid seed: ${seedArg}`);
  const flag = (name: string, def?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : def;
  };
  const rootArg = flag("root");
  if (!rootArg) throw new Error("--root is required");
  const root = resolve(rootArg);
  const resume = argv.includes("--resume");
  if (existsSync(root) && !resume) throw new Error(`Refusing to reuse ${root} (pass --resume to continue a partial arm-K group)`);
  const armCResultPath = flag("arm-c-result");
  if (!armCResultPath) throw new Error("--arm-c-result is required (an existing arm C result.json for the same task+seed)");
  const model = flag("model", "sonnet")!;
  const runnerPath = resolve(flag("runner", join(here, "bench-rq1.ts"))!);
  const concurrency = Number(flag("concurrency", "4"));
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`Invalid --concurrency: ${flag("concurrency")}`);
  const taskDir = resolve(taskArg);

  // loadTask() reads oracle/oracle.json only to name the selector (a string), and does so once here in the
  // attempt driver, never inside the selector itself, so the selection functions below still never import
  // bench-oracle.ts or see anything under oracle/ or fixtures/ (opus-reviewer, oracle-leak hazard (a)).
  const scorer = await import(pathToFileURL(resolve(here, "bench-oracle.ts")).href);
  const task = scorer.loadTask(taskDir);
  const kind: string = task.oracle.kind;
  const selectorName = SELECTOR_BY_KIND[kind];
  if (!selectorName) {
    throw new Error(`bench-ak.ts has no oracle-free selector for task ${task.task_id} (oracle.kind=${kind}); refusing rather than picking arbitrarily or via the oracle`);
  }

  const armC = JSON.parse(readFileSync(armCResultPath, "utf8"));
  const costUsd = armC?.usage?.cost_usd;
  if (!(costUsd > 0)) throw new Error("--arm-c-result has no positive cost_usd to match from");
  const capUsd = Number(flag("attempt-cap-usd", String(DEFAULT_ATTEMPT_CAP_USD)));
  const deadlineMs = Number(flag("attempt-deadline-ms", String(DEFAULT_ATTEMPT_DEADLINE_MS)));
  if (!(capUsd > 0) || !(deadlineMs > 0)) throw new Error("attempt cap and deadline must be positive");

  mkdirSync(root, { recursive: true });
  const attemptRoots = Array.from({ length: k }, (_, i) => join(root, `attempt-${i + 1}`));
  const runnerFailures: Record<number, string> = {};
  const reused: number[] = [];
  const startedAt = Date.now();
  await pool(k, concurrency, async (i) => {
    const attemptRoot = attemptRoots[i]!;
    if (existsSync(attemptRoot)) {
      if (readResult(attemptRoot)) {
        reused.push(i + 1); // resumable per attempt: a finished attempt is never re-run
        return;
      }
      renameSync(attemptRoot, `${attemptRoot}.partial-${Date.now()}`);
    }
    const run = await runAttempt(runnerPath, [taskDir, "A", String(seed * 1000 + i + 1), "--root", attemptRoot, "--model", model, "--max-budget-usd", String(capUsd), "--deadline-ms", String(deadlineMs)]);
    if (run.status !== 0 && !readResult(attemptRoot)) runnerFailures[i + 1] = run.stderr || `exit ${run.status}`;
  });
  const wallMs = Date.now() - startedAt;

  const results = attemptRoots.map(readResult);
  // A missing/killed attempt is a null vote: no answer, no candidate.
  const answers = attemptRoots.map((r, i) => (results[i] ? readAnswer(r) : null));
  let selection: Record<string, unknown>;
  let winnerIndex: number;
  if (selectorName === "plurality") {
    const m = selectByMajorityVote(answers);
    winnerIndex = m.winnerIndex;
    selection = { rule: "plurality of normalized answers (self-consistency, arXiv:2203.11171); ties and no signal break to lowest attempt", winner_attempt: winnerIndex + 1, votes: m.votes, normalized_answers: m.normalized };
  } else {
    const workspaces = attemptRoots.map((r, i) => (results[i] && existsSync(join(r, "workspace")) ? join(r, "workspace") : null));
    const m = selectPrintf(workspaces);
    winnerIndex = m.winnerIndex;
    selection = {
      rule: "MBR-exec execution agreement (arXiv:2204.11454) on README-grammar probes; ties to lowest attempt",
      winner_attempt: winnerIndex + 1,
      scores: m.scores,
      loaded: m.loaded,
      votes: m.votes,
      n_probes: m.n_probes,
      exploratory_secondary: { rule: "plurality of whole execution signatures (self-consistency, arXiv:2203.11171, applied to CodeT-style agreement classes, arXiv:2207.10397); NOT the primary selector", ...m.secondary },
    };
  }
  const selected = results[winnerIndex];

  // Cost: never zero for an unknown. Known sum + per-attempt cap for each unknown = upper bound; total is null when any is unknown.
  // usage.cost_usd is 0 (not absent) on a killed seat's rollup (src/result.ts rollupUsage), so "known"
  // is decided by coverage === "complete", never by the number alone (per measure-task-success-on-a-
  // machine-oracle: unknown cost must never be summed as zero).
  const knownCosts = results.map((r) => (r?.usage?.coverage === "complete" && typeof r.usage.cost_usd === "number" ? r.usage.cost_usd : null));
  const unknown = knownCosts.filter((c) => c === null).length;
  const knownSum = knownCosts.reduce<number>((s, c) => s + (c ?? 0), 0);
  const attemptsInfo = attemptRoots.map((r, i) => {
    const res = results[i];
    const seat = res?.seats?.[0];
    return {
      index: i + 1,
      root: r,
      answer: answers[i],
      outcome: res?.outcome ?? "no_result",
      passed: res?.passed ?? false,
      cost_usd: knownCosts[i],
      turns: res?.turns?.summed ?? null,
      wall_ms: res?.wall_clock?.duration_ms ?? null,
      exit_code: seat?.exit_code ?? null,
      signal: seat?.signal ?? null,
      killed_by_deadline: seat?.killed_by_deadline ?? false,
      runner_failure: runnerFailures[i + 1] ?? null,
    };
  });
  const result = {
    schemaVersion: 2,
    task_id: task.task_id,
    arm: "K",
    k,
    seed,
    model,
    selector: selectorName,
    selection,
    selected_attempt_result: selected ? { outcome: selected.outcome, passed: selected.passed, reason: selected.reason, oracle: selected.oracle } : null,
    outcome: selected?.outcome ?? "infrastructure_error",
    passed: selected?.passed ?? false,
    reason: selected?.reason ?? "infrastructure_error",
    oracle_ceiling: { any_attempt_passed: results.some((r) => r?.passed === true), n_passed: results.filter((r) => r?.passed === true).length, note: "NOT an arm: an upper bound on what any selector could achieve, computed with the oracle after selection" },
    matched_from: { arm_c_result: resolve(armCResultPath), arm_c_cost_usd: costUsd },
    budget: { attempt_cap_usd: capUsd, attempt_deadline_ms: deadlineMs, concurrency },
    usage: { cost_usd: unknown === 0 ? knownSum : null, cost_usd_known_sum: knownSum, cost_usd_unknown_attempts: unknown, cost_usd_upper_bound: knownSum + unknown * capUsd },
    turns_total: results.reduce((s, r) => s + (r?.turns?.summed ?? 0), 0),
    wall_clock: { duration_ms: wallMs, note: "elapsed for this invocation (attempts ran --concurrency at a time)", sum_of_attempt_ms: results.reduce((s, r) => s + (r?.wall_clock?.duration_ms ?? 0), 0) },
    resumed_attempts: reused.sort((a, b) => a - b),
    attempts: attemptsInfo,
    checked_at: new Date().toISOString(),
  };
  writeFileSync(join(root, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(root);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
