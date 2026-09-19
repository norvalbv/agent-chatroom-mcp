/**
 * Arm-B vs arm-C DIAGNOSTIC pilot table (claim/arm-b-run-and-stats). Reads run directories under PILOT_DIR
 * (stamp-interpreter-{B,C}-seed<N>/result.json) and SENTINEL_DIR (arm-A runs of the same task, a regime
 * indicator), lists every expected cell (missing cells are printed, never skipped), per-run cost, wall-clock
 * timestamps and per-seat output tokens, and one two-sided Fisher exact test B vs C. n is far too small for
 * that test to show equivalence; it is printed only so the number is not hand-typed.
 *
 * Usage: node --import tsx scripts/paper-rq1-armb-pilot.ts PILOT_DIR SENTINEL_DIR SEEDS(e.g. 401-405)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fisherExactTest } from "./rq1-stats.js";

interface Cell {
  arm: string;
  seed: number;
  outcome: string;
  cost: number | null;
  coverage: string;
  started: string;
  completed: string;
  seatTokens: string;
  headRevision: string;
  deadlineHit: boolean;
}

function load(dir: string, arm: string, seed: number): Cell | null {
  const path = join(dir, `stamp-interpreter-${arm}-seed${seed}`, "result.json");
  if (!existsSync(path)) return null;
  const r = JSON.parse(readFileSync(path, "utf8"));
  const seats: any[] = r.seats ?? [];
  return {
    arm,
    seed,
    outcome: r.outcome,
    cost: typeof r.usage?.cost_usd === "number" && r.usage.coverage === "complete" ? r.usage.cost_usd : null,
    coverage: r.usage?.coverage ?? "unknown",
    started: r.wall_clock.started_at,
    completed: r.wall_clock.completed_at,
    seatTokens: seats.map((s) => `${s.name}=${s.usage?.output_tokens ?? "?"}`).join(" "),
    headRevision: r.build?.head_revision ?? "?",
    deadlineHit: seats.some((s) => s.killed_by_deadline === true),
  };
}

export function seedRange(spec: string): number[] {
  const [a, b] = spec.split("-").map(Number);
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
}

function main() {
  const [pilotDir, sentinelDir, seedSpec] = process.argv.slice(2);
  if (!pilotDir || !sentinelDir || !seedSpec) throw new Error("Usage: paper-rq1-armb-pilot.ts PILOT_DIR SENTINEL_DIR SEEDS");
  const seeds = seedRange(seedSpec);
  const rows: string[] = ["| arm | seed | outcome | cost USD | started (UTC) | completed (UTC) | output tokens per seat | build | deadline hit |", "|---|---|---|---|---|---|---|---|---|"];
  const missing: string[] = [];
  const cells: Cell[] = [];
  for (const [dir, arms] of [[pilotDir, ["B", "C"]], [sentinelDir, ["A"]]] as const) {
    for (const seed of seeds) {
      for (const arm of arms) {
        const c = load(dir, arm, seed);
        if (!c) {
          missing.push(`${arm} seed${seed}`);
          continue;
        }
        cells.push(c);
        rows.push(`| ${arm} | ${seed} | ${c.outcome} | ${c.cost === null ? "unknown" : c.cost.toFixed(3)} | ${c.started.slice(11, 19)} | ${c.completed.slice(11, 19)} | ${c.seatTokens} | ${c.headRevision.slice(0, 7)} | ${c.deadlineHit ? "YES" : "no"} |`);
      }
    }
  }
  const by = (arm: string) => cells.filter((c) => c.arm === arm);
  const summary: string[] = ["", "| arm | n | pass | pass rate | total cost USD | cost per pass USD |", "|---|---|---|---|---|---|"];
  for (const arm of ["A", "B", "C"]) {
    const cs = by(arm);
    const pass = cs.filter((c) => c.outcome === "task_pass").length;
    const costKnown = cs.every((c) => c.cost !== null);
    const total = cs.reduce((a, c) => a + (c.cost ?? 0), 0);
    summary.push(`| ${arm} | ${cs.length} | ${pass} | ${cs.length ? (pass / cs.length).toFixed(2) : "n/a"} | ${costKnown ? total.toFixed(3) : "unknown (partial usage)"} | ${costKnown && pass ? (total / pass).toFixed(3) : "undefined"} |`);
  }
  const b = by("B"), c = by("C");
  const bp = b.filter((x) => x.outcome === "task_pass").length;
  const cp = c.filter((x) => x.outcome === "task_pass").length;
  const out = [
    "# Arm-B vs arm-C diagnostic pilot (stamp-interpreter)",
    "",
    "DIAGNOSTIC ONLY. n is at most " + seeds.length + " per arm; power is negligible (evidence/power-and-inference), so nothing here shows equivalence or a difference.",
    "",
    ...rows,
    ...summary,
    "",
    missing.length ? `MISSING cells (not counted): ${missing.join(", ")}` : "No missing cells.",
    b.length && c.length ? `Fisher exact B vs C, two-sided, unadjusted: B ${bp}/${b.length} vs C ${cp}/${c.length}, p = ${fisherExactTest(bp, b.length - bp, cp, c.length - cp).p_value?.toFixed(4)}` : "Fisher B vs C: not computable (an arm has no cells).",
  ];
  console.log(out.join("\n"));
}

main();
