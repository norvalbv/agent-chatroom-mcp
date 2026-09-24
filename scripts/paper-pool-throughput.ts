/**
 * Study 3 (pool throughput, docs/experiments/2026-09-23-pool-throughput.md): per pool and setup, items passing in
 * each counted run (minutes), the mean of the two repeats, and cost per passing item (total cost over total items
 * passed); then the pre-registered direction count, where a difference counts when two setups' means differ by 3 or
 * more items in the same direction in at least two of the three pools (a pool with a setup missing a repeat gives no
 * direction). Reads the committed sanitized records (scripts/pool-results-export.ts); pilots and voided runs are
 * listed in the JSON and never counted.
 *
 * Usage: node --import tsx scripts/paper-pool-throughput.ts bench/results/pool-throughput --out paper/generated/pool-throughput --tex paper/tables/pool-throughput.tex
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolRunRecord } from "./pool-results-export.ts";

export const POOLS = ["hub", "game", "frink"] as const;
export const POOL_LABEL: Record<string, string> = { hub: "Pool 1 (this system)", game: "Pool 2 (browser game)", frink: "Pool 3 (product repository)" };
export const SETUPS = ["solo", "split", "room3", "room15"] as const;
export const SETUP_LABEL: Record<string, string> = { solo: "Solo", split: "Split", room3: "Room3", room15: "Room15" };
/** The pre-registered predictions: [first setup, second setup, expected relation]. */
export const PREDICTIONS = [
  { n: 1, a: "split", b: "solo", expect: "more", text: "Split lands more items than Solo" },
  { n: 2, a: "room3", b: "split", expect: "no difference", text: "Room3 and Split do not differ" },
  { n: 3, a: "room15", b: "room3", expect: "more", text: "Room15 lands more items than Room3" },
] as const;
export const THRESHOLD = 3;

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function loadRecords(dir: string): PoolRunRecord[] {
  const out: PoolRunRecord[] = [];
  for (const pool of readdirSync(dir).sort()) {
    const p = join(dir, pool);
    for (const f of readdirSync(p).sort()) if (f.endsWith(".json")) out.push(JSON.parse(readFileSync(join(p, f), "utf8")));
  }
  return out;
}

export type Cell = { runs: { rep: number; passed: number; minutes: number | null; cost_usd: number | null }[]; mean: number | null; cost_per_passing_item: number | null };

export function summarise(records: PoolRunRecord[]) {
  const counted = records.filter((r) => r.status === "counted");
  const cells: Record<string, Record<string, Cell>> = {};
  for (const pool of POOLS) {
    cells[pool] = {};
    for (const setup of SETUPS) {
      const runs = counted.filter((r) => r.pool === pool && r.arm === setup).sort((a, b) => a.rep - b.rep)
        .map((r) => ({ rep: r.rep, passed: r.passed, minutes: r.minutes, cost_usd: r.cost_usd }));
      const complete = runs.length === 2;
      const passed = runs.reduce((s, r) => s + r.passed, 0);
      const costs = runs.map((r) => r.cost_usd);
      const cost = runs.length && costs.every((c) => c !== null) && passed > 0 ? round((costs as number[]).reduce((s, c) => s + c, 0) / passed, 2) : null;
      cells[pool][setup] = { runs, mean: complete ? round(passed / 2, 1) : null, cost_per_passing_item: cost };
    }
  }
  const directions = PREDICTIONS.map((p) => {
    const perPool = POOLS.map((pool) => {
      const a = cells[pool][p.a].mean, b = cells[pool][p.b].mean;
      if (a === null || b === null) return { pool, diff: null, direction: "incomplete" as const };
      const diff = round(a - b, 1);
      return { pool, diff, direction: diff >= THRESHOLD ? ("more" as const) : diff <= -THRESHOLD ? ("fewer" as const) : ("no difference" as const) };
    });
    const matching = perPool.filter((x) => x.direction === p.expect).length;
    // Contradicted: at least two pools show a difference in the same direction, and it is not the predicted one.
    // Two pools showing no difference leave a directional prediction unsupported, not contradicted.
    const against = (["more", "fewer"] as const).filter((d) => d !== p.expect && perPool.filter((x) => x.direction === d).length >= 2);
    const verdict = matching >= 2 ? "supported" : against.length ? "contradicted" : "not supported";
    return { ...p, per_pool: perPool, pools_matching: matching, verdict };
  });
  const other = records.filter((r) => r.status !== "counted").map((r) => ({ pool: r.pool, arm: r.arm, rep: r.rep, status: r.status, void_reason: r.void_reason, passed: r.passed, attempted: r.attempted, minutes: r.minutes, cost_usd: r.cost_usd }));
  const incompletePools = POOLS.filter((pool) => SETUPS.some((s) => cells[pool][s].runs.length < 2));
  return { cells, directions, pilots_and_voided: other, incomplete_pools: incompletePools, threshold: THRESHOLD };
}

const fmtRun = (r: Cell["runs"][number]) => `${r.passed} (${r.minutes === null ? "?" : r.minutes.toFixed(1)})`;

export function toTex(s: ReturnType<typeof summarise>): string {
  const lines = ["\\begin{tabular}{llllr}", "\\toprule", "Pool & Setup & Repeat 1 (min) & Repeat 2 (min) & Cost per passing item \\\\", "\\midrule"];
  POOLS.forEach((pool, i) => {
    if (i) lines.push("\\midrule");
    SETUPS.forEach((setup, j) => {
      const c = s.cells[pool][setup];
      const byRep = (rep: number) => { const r = c.runs.find((x) => x.rep === rep); return r ? fmtRun(r) : "not run"; };
      lines.push(`${j === 0 ? POOL_LABEL[pool] : ""} & ${SETUP_LABEL[setup]} & ${byRep(1)} & ${byRep(2)} & ${c.cost_per_passing_item === null ? "--" : `\\$${c.cost_per_passing_item.toFixed(2)}`} \\\\`);
    });
  });
  lines.push("\\bottomrule", "\\end{tabular}", "");
  return lines.join("\n");
}

export function toMarkdown(s: ReturnType<typeof summarise>): string {
  const out = ["# Study 3: pool throughput (generated by scripts/paper-pool-throughput.ts)", "", "Items passing of 20 (minutes); mean of two repeats; cost per passing item (USD).", "", "| Pool | Setup | Rep 1 | Rep 2 | Mean | Cost per passing item |", "|---|---|---|---|---|---|"];
  for (const pool of POOLS) for (const setup of SETUPS) {
    const c = s.cells[pool][setup];
    const byRep = (rep: number) => { const r = c.runs.find((x) => x.rep === rep); return r ? fmtRun(r) : "not run"; };
    out.push(`| ${POOL_LABEL[pool]} | ${SETUP_LABEL[setup]} | ${byRep(1)} | ${byRep(2)} | ${c.mean ?? "--"} | ${c.cost_per_passing_item ?? "--"} |`);
  }
  out.push("", "## Direction count (difference of 3 or more items, same direction in at least two pools)", "");
  for (const d of s.directions) out.push(`- Prediction ${d.n} (${d.text}): ${d.per_pool.map((p) => `${p.pool} ${p.diff ?? "--"} (${p.direction})`).join("; ")}; pools matching ${d.pools_matching}; verdict: ${d.verdict}`);
  out.push("", "## Pilots and voided runs (never counted)", "");
  for (const r of s.pilots_and_voided) out.push(`- ${r.pool} ${r.arm} rep ${r.rep} (${r.status}${r.void_reason ? `: ${r.void_reason}` : ""}): ${r.passed} passed of ${r.attempted ?? "?"} attempted, ${r.minutes ?? "?"} min`);
  return `${out.join("\n")}\n`;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const dir = process.argv[2];
  const outIdx = process.argv.indexOf("--out"), texIdx = process.argv.indexOf("--tex");
  if (!dir || outIdx < 0 || !existsSync(dir)) {
    console.error("usage: paper-pool-throughput.ts RECORDS --out PREFIX [--tex FILE]");
    process.exit(2);
  }
  const s = summarise(loadRecords(resolve(dir)));
  const prefix = resolve(process.argv[outIdx + 1]);
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(`${prefix}.json`, `${JSON.stringify(s, null, 2)}\n`);
  writeFileSync(`${prefix}.md`, toMarkdown(s));
  if (texIdx > 0) writeFileSync(resolve(process.argv[texIdx + 1]), toTex(s));
}
