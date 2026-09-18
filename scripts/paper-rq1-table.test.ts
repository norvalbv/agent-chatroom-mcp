/** node --import tsx scripts/paper-rq1-table.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadRunResults, computeCell, buildTable, renderMarkdown, renderCsv } from "./paper-rq1-table.js";

function run(task: string, arm: string, seed: number, outcome: string, opts: Partial<{ cost: number; turns: number; wallMs: number; coverage: "complete" | "partial" | "none" }> = {}) {
  const cost = opts.cost ?? 0.01;
  return {
    schemaVersion: 1 as const, task_id: task, arm, seed, model: "claude-sonnet-5", outcome, passed: outcome === "task_pass", reason: outcome,
    usage: { input_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 100, output_tokens: 200, cost_usd: cost, coverage: opts.coverage ?? "complete", seats: 1, seats_with_usage: 1, steps: 0, prompt_tokens: 0, completion_tokens: 0 },
    turns: { summed: opts.turns ?? 5, coverage: "complete" as const },
    wall_clock: { started_at: "2026-09-18T00:00:00.000Z", completed_at: new Date(Date.parse("2026-09-18T00:00:00.000Z") + (opts.wallMs ?? 60000)).toISOString(), duration_ms: opts.wallMs ?? 60000 },
  };
}

function fixtureDir(runs: ReturnType<typeof run>[], extraFiles: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rq1-table-fixture-"));
  // Mirrors bench-rq1.ts's own --root layout: RESULTS_DIR/<run>/result.json.
  runs.forEach((r, i) => {
    const runDir = join(dir, `${r.task_id}-${r.arm}-seed${r.seed}-${i}`);
    mkdirSync(runDir);
    writeFileSync(join(runDir, "result.json"), JSON.stringify(r));
  });
  for (const [name, content] of Object.entries(extraFiles)) writeFileSync(join(dir, name), content);
  return dir;
}

test("loadRunResults skips non-schema files with a warning, never throws", () => {
  const dir = fixtureDir([run("bench-fact-check", "A", 1, "task_pass")], { "notes.json": "not an array of run results", "junk.txt": "ignored, not .json" });
  try {
    const { runs, warnings } = loadRunResults(dir);
    assert.equal(runs.length, 1);
    assert.ok(warnings.some((w) => w.includes("notes.json")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("computeCell: success rate excludes parse_failure/timeout/infrastructure_error from the denominator (protocol.md §4)", () => {
  const runs = [run("t", "C", 1, "task_pass"), run("t", "C", 2, "task_fail"), run("t", "C", 3, "parse_failure"), run("t", "C", 4, "timeout"), run("t", "C", 5, "infrastructure_error")];
  const cell = computeCell("t", "C", runs);
  assert.equal(cell.success_denominator, 2, "only task_pass+task_fail count toward the denominator");
  assert.equal(cell.success_rate, 0.5);
  // comparable flag (bench-compare's definition) excludes only timeout/infra/tamper, not parse_failure.
  assert.equal(cell.comparable_n, 3);
});

test("computeCell: cost_per_correct is the string 'undefined' (not 0) with zero task_pass", () => {
  const cell = computeCell("t", "A", [run("t", "A", 1, "task_fail", { cost: 0.5 })]);
  assert.equal(cell.cost_per_correct, "undefined");
});

test("computeCell: cost_per_correct divides total arm cost by task_pass count", () => {
  const runs = [run("t", "A", 1, "task_pass", { cost: 0.3 }), run("t", "A", 2, "task_pass", { cost: 0.5 }), run("t", "A", 3, "task_fail", { cost: 0.2 })];
  const cell = computeCell("t", "A", runs);
  assert.ok(Math.abs((cell.cost_per_correct as number) - 0.5) < 1e-9, `got ${cell.cost_per_correct}`); // (0.3+0.5+0.2)/2
});

test("buildTable: runs the arm-pair test only when both A and C are present for a task", () => {
  const runs = [
    ...Array.from({ length: 12 }, (_, i) => run("t1", "A", i, i < 6 ? "task_pass" : "task_fail")),
    ...Array.from({ length: 12 }, (_, i) => run("t1", "C", i, i < 7 ? "task_pass" : "task_fail")),
    ...Array.from({ length: 3 }, (_, i) => run("t2", "C", i, "task_pass")), // no arm A for t2
  ];
  const { tests } = buildTable(runs);
  assert.equal(tests.length, 1);
  assert.equal(tests[0].task, "t1");
  assert.equal(tests[0].test, "z"); // all cells >=5: pass/fail 6/6 vs 7/5
  assert.ok(tests[0].p_value !== null);
});

test("renderMarkdown and renderCsv include every cell and the significance row, CSV has a header", () => {
  const runs = [run("t", "A", 1, "task_pass"), run("t", "C", 1, "task_fail")];
  const { cells, tests } = buildTable(runs);
  const md = renderMarkdown(cells, tests, []);
  assert.match(md, /task_pass/);
  assert.match(md, /Fisher|z/);
  const csv = renderCsv(cells);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 3); // header + A row + C row
  assert.match(lines[0], /^task,arm,n,/);
});

test("end-to-end CLI: writes .md and .csv from a fixture directory", () => {
  const runs = [
    run("bench-fact-check", "A", 1, "task_pass", { cost: 0.02 }),
    run("bench-fact-check", "C", 1, "task_pass", { cost: 0.4 }),
  ];
  const dir = fixtureDir(runs);
  const outPrefix = join(dir, "out", "rq1");
  try {
    const script = resolve("scripts/paper-rq1-table.ts");
    const result = spawnSync(process.execPath, ["--import", "tsx", script, dir, "--out", outPrefix], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(existsSync(`${outPrefix}.md`));
    assert.ok(existsSync(`${outPrefix}.csv`));
    const csv = readFileSync(`${outPrefix}.csv`, "utf8");
    assert.match(csv, /bench-fact-check,A/);
    assert.match(csv, /bench-fact-check,C/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log("PAPER RQ1 TABLE OK");
