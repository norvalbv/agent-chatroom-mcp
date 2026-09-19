/** Offline tests for deterministic build-suite table generation. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBuildReport, renderBuildReportMarkdown } from "./bench-build-report.js";

function result(task: string, arm: "A" | "B" | "C", seed: number, caught: number, cost: number | null, fingerprint = "fp") {
  return {
    schemaVersion: 1, task_id: task, arm, seed, outcome: "completed",
    scores: { defects_caught: caught, defects_total: 9, defects_shipped: 9 - caught, regression_failures: 0, regressions_total: 14 },
    checks: {
      defects: Array.from({ length: 9 }, (_, i) => ({ name: `defect/D${String(i + 1).padStart(2, "0")}`, exit_code: i < caught ? 0 : 1 })),
      regressions: Array.from({ length: 14 }, (_, i) => ({ name: `regression/R${String(i + 1).padStart(2, "0")}`, exit_code: 0 })),
    },
    usage: { cost_usd: cost, coverage: cost === null ? "partial" : "complete", thinking_tokens: 100 + seed, output_tokens: 200 },
    wall_clock_ms: 1000, seats: arm === "C" ? 4 : arm === "B" ? 2 : 1,
    effort: { level: "medium", settings_sha256: "settings", own_git_root: true },
    provenance: { run_fingerprint: fingerprint, manifest_sha256: "manifest", runner_sha256: "runner", task_sha256_before_score: "task", task_sha256_after_score: "task" },
  };
}

function put(root: string, body: ReturnType<typeof result>, suffix = "") {
  const dir = join(root, `${body.task_id}-${body.arm}-seed${body.seed}${suffix}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "build-result.json"), JSON.stringify(body));
}

test("report keeps planned missing cells and flags actual nominal-cap overshoot", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-build-report-"));
  try {
    put(dir, result("build-billing-s1", "A", 101, 4, 1.5));
    put(dir, result("build-billing-s1", "B", 101, 5, 2.1));
    const report = buildBuildReport(dir, ["build-billing-s1"], ["A", "B", "C"], [101], 2);
    assert.equal(report.rows.length, 3);
    assert.equal(report.rows.find((r) => r.arm === "B")?.actual_over_cap, true);
    assert.equal(report.rows.find((r) => r.arm === "C")?.status, "missing");
    assert.equal(report.summary.missing, 1);
    const markdown = renderBuildReportMarkdown(report);
    assert.match(markdown, /build-billing-s1 \| B \| 101 \| valid \| completed \| 5\/9 \| 4 \| 0 \| 2\.1000 \| yes/);
    assert.match(markdown, /build-billing-s1 \| C \| 101 \| missing \| -/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("report keeps an oracle-scored catch row when cost is unknown and never substitutes zero", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-build-report-"));
  try {
    put(dir, result("build-billing-s1", "A", 1, 4, null));
    const report = buildBuildReport(dir, ["build-billing-s1"], ["A"], [1], 2);
    assert.equal(report.rows[0].status, "valid");
    assert.equal(report.rows[0].defects_caught, 4);
    assert.equal(report.rows[0].cost_status, "unknown");
    assert.equal(report.rows[0].cost_usd, null);
    assert.equal(report.summary.known_cost_usd, 0);
    assert.equal(report.summary.invalid, 0);
    assert.equal(report.summary.unknown_cost, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("report scores arm protocol failures as-is but rejects integrity failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-build-report-"));
  try {
    const noConclusion = result("build-ledger-v2-s1", "C", 101, 3, 0.4);
    noConclusion.outcome = "invalid_room";
    put(dir, noConclusion);
    const tamper = result("build-ledger-v2-s1", "B", 101, 8, 0.2);
    tamper.outcome = "tamper";
    put(dir, tamper);
    const report = buildBuildReport(dir, ["build-ledger-v2-s1"], ["B", "C"], [101], 2);
    const c = report.rows.find((row) => row.arm === "C")!;
    assert.equal(c.status, "valid");
    assert.equal(c.protocol_failure, true);
    assert.equal(c.defects_caught, 3);
    assert.equal(report.rows.find((row) => row.arm === "B")?.status, "invalid");
    assert.equal(report.summary.protocol_failures, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("report refuses duplicate cells and missing provenance fingerprints", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-build-report-"));
  try {
    put(dir, result("build-billing-s1", "A", 1, 4, 0.2));
    put(dir, result("build-billing-s1", "A", 1, 5, 0.3), "-duplicate");
    assert.throws(() => buildBuildReport(dir, ["build-billing-s1"], ["A"], [1], 2), /duplicate cell/i);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
    put(dir, result("build-billing-s1", "A", 1, 4, 0.2, ""));
    const report = buildBuildReport(dir, ["build-billing-s1"], ["A"], [1], 2);
    assert.equal(report.rows[0].status, "invalid");
    assert.match(report.rows[0].reason ?? "", /fingerprint/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("admission catch table counts each named defect over valid A runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-build-report-"));
  try {
    put(dir, result("build-billing-s1", "A", 1, 2, 0.2));
    put(dir, result("build-billing-s1", "A", 2, 1, 0.2));
    const report = buildBuildReport(dir, ["build-billing-s1"], ["A"], [1, 2], 2);
    assert.deepEqual(report.per_defect.slice(0, 3), [
      { task_id: "build-billing-s1", defect_id: "D01", caught: 2, n: 2 },
      { task_id: "build-billing-s1", defect_id: "D02", caught: 1, n: 2 },
      { task_id: "build-billing-s1", defect_id: "D03", caught: 0, n: 2 },
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
