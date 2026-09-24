/**
 * Exports pool-throughput run records (paper Study 3, docs/experiments/2026-09-23-pool-throughput.md) into
 * committed, sanitized per-run JSON: no local paths, account e-mails, transcripts or test output, only what the
 * paper's tables and prose use. Input is a records directory laid out <pool>/<run-dir>/{run,score}.json, as
 * scripts/pool.ts run and score write them; output is <out>/<pool>/<run-dir>.json. A run directory named
 * <arm>-rep9N is a practice pilot (excluded from every measure); one named <arm>-repN-VOID-<reason> is a voided run.
 *
 * Usage: node --import tsx scripts/pool-results-export.ts RECORDS_DIR --out bench/results/pool-throughput
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PoolRunRecord = {
  pool: string;
  pool_sha256: string;
  arm: string;
  rep: number;
  status: "counted" | "pilot" | "void";
  void_reason: string | null;
  model: string;
  deadline_min: number;
  started_at: string;
  ended_at: string | null;
  minutes: number | null;
  stopped_at_deadline: boolean;
  passed: number;
  of: number;
  attempted: number | null;
  items: { id: string; pass: boolean; attempted: boolean | null }[];
  suite_pass: boolean | null;
  conflicts: number;
  missing_branches: number;
  cost_usd: number | null;
  cost_estimated: boolean;
  account: number | null;
  audit_hits: number;
};

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** One sanitized record from a run directory's run.json and score.json. */
export function exportRun(runDir: string, dirName: string): PoolRunRecord {
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const score = JSON.parse(readFileSync(join(runDir, "score.json"), "utf8"));
  const voided = /-VOID-(.+)$/.exec(dirName);
  const status = voided ? "void" : run.rep >= 90 ? "pilot" : "counted";
  const started = Date.parse(run.started_at), ended = run.ended_at ? Date.parse(run.ended_at) : NaN;
  const seats: { killed_by_deadline?: boolean | null }[] = run.seats ?? [];
  const stoppedAtDeadline = run.room ? !!run.room.stopped_at_deadline : seats.some((s) => s.killed_by_deadline === true);
  const account = score.account?.account ?? run.account?.account ?? null;
  return {
    pool: score.pool ?? run.pool,
    pool_sha256: score.pool_sha256 ?? run.pool_sha256,
    arm: score.arm ?? run.arm,
    rep: score.rep ?? run.rep,
    status,
    void_reason: voided ? voided[1] : null,
    model: run.model,
    deadline_min: run.deadline_min,
    started_at: run.started_at,
    ended_at: run.ended_at ?? null,
    minutes: Number.isFinite(ended) ? round((ended - started) / 60_000, 1) : null,
    stopped_at_deadline: stoppedAtDeadline,
    passed: score.passed,
    of: score.of,
    attempted: score.attempted ?? null,
    items: (score.items ?? []).map((i: { id: string; pass: boolean; attempted?: boolean }) => ({ id: i.id, pass: !!i.pass, attempted: i.attempted ?? null })),
    suite_pass: score.suite ? !!score.suite.pass : null,
    conflicts: score.conflicts ?? 0,
    missing_branches: (score.missing_branches ?? []).length,
    cost_usd: Number.isFinite(score.cost_usd) ? round(score.cost_usd, 4) : null,
    cost_estimated: !!score.cost_estimated,
    account: typeof account === "number" ? account : account === null ? null : Number(account),
    audit_hits: score.audit_hits ?? 0,
  };
}

export function exportAll(recordsDir: string, outDir: string): PoolRunRecord[] {
  const out: PoolRunRecord[] = [];
  for (const pool of readdirSync(recordsDir).sort()) {
    const poolDir = join(recordsDir, pool);
    for (const dirName of readdirSync(poolDir).sort()) {
      const runDir = join(poolDir, dirName);
      if (!existsSync(join(runDir, "run.json")) || !existsSync(join(runDir, "score.json"))) continue;
      const rec = exportRun(runDir, dirName);
      mkdirSync(join(outDir, pool), { recursive: true });
      writeFileSync(join(outDir, pool, `${dirName}.json`), `${JSON.stringify(rec, null, 2)}\n`);
      out.push(rec);
    }
  }
  return out;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const records = process.argv[2];
  const outIdx = process.argv.indexOf("--out");
  if (!records || outIdx < 0) {
    console.error("usage: pool-results-export.ts RECORDS_DIR --out DIR");
    process.exit(2);
  }
  const recs = exportAll(resolve(records), resolve(process.argv[outIdx + 1]));
  console.log(`exported ${recs.length} runs (${recs.filter((r) => r.status === "counted").length} counted)`);
}
