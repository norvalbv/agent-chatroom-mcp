/** Offline forensic measurement, zero model spend: for the exact-answer primary family
 * (stamp-interpreter, stamp-2), is arm C's committed final answer the same as the plurality answer among
 * that seed's independent arm-K attempts?
 *
 * This is a distinct question from "does arm C pass the oracle" (already reported) and from
 * evidence/arm-c-process-trace's self-reported in-transcript correction signal (this room, 5-6-sol-15):
 * it asks whether deliberation's *output* diverges from what k independent, non-communicating attempts
 * would have converged on anyway. If C almost always agrees with the K-plurality, the room's win on this
 * suite is aggregation-equivalent (voting would have found the same answer); if it often disagrees, there
 * is measured headroom for deliberation to do something voting could not.
 *
 * Reads only committed bench/results/rq1-suite (arm C's workspace/answer.txt) and bench/results/rq1-arm-k
 * (each K result.json's own precomputed selection, via bench-ak.ts's exported normalize/selectByMajorityVote
 * -- recomputed here, not merely read back, so this is an independent check of the same numbers, not just a
 * copy of the selector's own recorded winner). Never writes into either directory.
 *
 * node --import tsx scripts/conv-forensics.ts [--suite-dir bench/results/rq1-suite]
 *   [--armk-dir bench/results/rq1-arm-k] [--tasks stamp-interpreter,stamp-2]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalize, selectByMajorityVote } from "./bench-ak.ts";

export interface SeedResult {
  seed: number;
  cArmAnswer: string | null;
  kPlurality: string | null;
  agree: boolean | null; // null when either side has no answer to compare (parse/format failure)
}

export interface TaskReport {
  task: string;
  seeds: SeedResult[];
  agreeCount: number;
  compared: number;
}

/** One task's forensic pass: every `${task}-K-seed*` directory under armkDir paired against the matching
 * `${task}-C-seed<N>` directory under suiteDir (seed number from the directory name, not the K result's own
 * `matched_from` path, so this works unmodified across machines/worktrees). A seed with no arm-C workspace
 * answer or no arm-K normalized answers is recorded with agree=null and excluded from the rate (parse
 * failure, not a disagreement). */
export function runTask(suiteDir: string, armkDir: string, task: string): TaskReport {
  const seeds: SeedResult[] = [];
  const prefix = `${task}-K-seed`;
  const dirs = existsSync(armkDir) ? readdirSync(armkDir).filter((d) => d.startsWith(prefix)) : [];
  for (const d of dirs.sort()) {
    const seed = Number(d.slice(prefix.length));
    if (!Number.isInteger(seed)) continue;
    const kResultPath = join(armkDir, d, "result.json");
    if (!existsSync(kResultPath)) continue;
    const kResult = JSON.parse(readFileSync(kResultPath, "utf8"));
    // Recomputed independently, not merely read back: kResult.selection.normalized_answers is expected to
    // already be normalized by the K pipeline (bench-ak.ts), but re-normalizing here is idempotent and
    // guards against this check silently trusting whatever the selector happened to store.
    const rawAnswers: (string | null)[] = kResult.selection?.normalized_answers ?? [];
    const normalizedAnswers = rawAnswers.map((a) => (a === null ? null : normalize(a)));
    const kPlurality = normalizedAnswers.length ? selectAnswer(normalizedAnswers) : null;

    const cAnswerPath = join(suiteDir, `${task}-C-seed${seed}`, "workspace", "answer.txt");
    const cArmAnswerRaw = existsSync(cAnswerPath) ? readFileSync(cAnswerPath, "utf8") : null;
    const cArmAnswer = cArmAnswerRaw === null ? null : normalize(cArmAnswerRaw);

    const agree = kPlurality === null || cArmAnswer === null ? null : kPlurality === cArmAnswer;
    seeds.push({ seed, cArmAnswer, kPlurality, agree });
  }
  const compared = seeds.filter((s) => s.agree !== null);
  return { task, seeds, agreeCount: compared.filter((s) => s.agree).length, compared: compared.length };
}

function selectAnswer(normalizedAnswers: (string | null)[]): string | null {
  const { winnerIndex } = selectByMajorityVote(normalizedAnswers as string[]);
  return normalizedAnswers[winnerIndex] ?? null;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string, def: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : def;
  };
  const suiteDir = resolve(flag("suite-dir", "bench/results/rq1-suite"));
  const armkDir = resolve(flag("armk-dir", "bench/results/rq1-arm-k"));
  const tasks = flag("tasks", "stamp-interpreter,stamp-2").split(",").filter(Boolean);

  const reports = tasks.map((t) => runTask(suiteDir, armkDir, t));
  const totalCompared = reports.reduce((a, r) => a + r.compared, 0);
  const totalAgree = reports.reduce((a, r) => a + r.agreeCount, 0);
  console.log(
    JSON.stringify(
      {
        reports: reports.map((r) => ({ task: r.task, compared: r.compared, agree: r.agreeCount, rate: r.compared ? r.agreeCount / r.compared : null })),
        pooled: { compared: totalCompared, agree: totalAgree, rate: totalCompared ? totalAgree / totalCompared : null },
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
