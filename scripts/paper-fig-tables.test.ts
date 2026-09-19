/** node --import tsx scripts/paper-fig-tables.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { renderPassRateTable, renderCostTable } from "./paper-fig-tables.js";
import type { FigData } from "./paper-fig-data.js";

function fixture(): FigData {
  return {
    generated_from: { suite_dir: "x", arm_k_dir: "y" },
    pass_rates: [
      { task: "stamp-2", arm: "K", n: 40, pass: 39, rate: 0.975, ci_lo: 0.871, ci_hi: 0.996 },
      { task: "stamp-interpreter", arm: "A", n: 40, pass: 33, rate: 0.825, ci_lo: 0.681, ci_hi: 0.913 },
    ],
    cost_per_correct: [
      { task: "stamp-2", arm: "K", cost_per_correct: 0.5454, n: 40, pass: 39 },
      { task: "bench-printf-format", arm: "C", cost_per_correct: null, n: 40, pass: 0 },
    ],
    vote_distributions: [],
    armk_group_votes: [],
    cost_vs_accuracy: [],
    warnings: [],
  };
}

test("renderPassRateTable: sorts by task then arm order, escapes underscores, formats undefined CI as --", () => {
  const tex = renderPassRateTable(fixture());
  const iInterp = tex.indexOf("stamp-interpreter");
  const iStamp2 = tex.indexOf("stamp-2 &"); // the row, not the caption
  assert.ok(iInterp !== -1 && iStamp2 !== -1 && iInterp < iStamp2, "stamp-interpreter must sort before stamp-2 (task order)");
  assert.match(tex, /82\.5\\%/);
  assert.match(tex, /\\begin\{table\}/);
});

test("renderCostTable: null cost_per_correct renders as 'undefined', never $0.0000", () => {
  const tex = renderCostTable(fixture());
  assert.match(tex, /bench-printf-format & C \(chatroom\) & 0\/40 & undefined/);
  assert.doesNotMatch(tex, /\$0\.0000/);
});

test("end-to-end CLI: regenerates both .tex files from the real committed fig-data.json", () => {
  const outDir = mkdtempSync(join(tmpdir(), "fig-tables-out-"));
  try {
    const script = resolve("scripts/paper-fig-tables.ts");
    const figData = resolve("paper/generated/fig-data.json");
    assert.ok(existsSync(figData), "run scripts/paper-fig-data.ts first (committed artifact should already exist)");
    const result = spawnSync(process.execPath, ["--import", "tsx", script, figData, outDir], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(existsSync(join(outDir, "pass-rate-table.tex")));
    assert.ok(existsSync(join(outDir, "cost-per-correct-table.tex")));
    const tex = readFileSync(join(outDir, "pass-rate-table.tex"), "utf8");
    assert.match(tex, /stamp-interpreter/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

console.log("PAPER FIG TABLES OK");
