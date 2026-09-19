import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

function fixture(missing = false) {
  const root = mkdtempSync(join(tmpdir(), "paper-window-control-"));
  for (const dir of ["rq1-suite", "rq1-arm-k", "rq1-window-control"]) mkdirSync(join(root, dir));
  for (let seed = 201; seed <= 212; seed++) for (const arm of ["C", "K"]) {
    if (missing && seed === 212 && arm === "K") continue;
    const dir = join(root, "rq1-window-control", `stamp-interpreter-${arm}-seed${seed}`);
    mkdirSync(dir);
    const passed = arm === "C" ? ![201, 210].includes(seed) : ![202, 209].includes(seed);
    writeFileSync(join(dir, "result.json"), JSON.stringify({ task_id: "stamp-interpreter", arm, seed,
      outcome: passed ? "task_pass" : "task_fail", attempts: arm === "K" ? [{ passed: seed !== 201 }, { passed: false }] : undefined }));
  }
  return root;
}

function render(root: string) {
  const run = spawnSync(process.execPath, ["--import", "tsx", resolve("scripts/paper-rq1-tex.ts"),
    join(root, "rq1-suite"), join(root, "rq1-arm-k"), "--out-dir", join(root, "out")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return readFileSync(join(root, "out", "window-control-status.tex"), "utf8");
}

test("complete window control derives separate long, crossover, and short counts from artifacts", () => {
  const root = fixture();
  try {
    const tex = render(root);
    assert.match(tex, /complete, 24\/24/);
    assert.match(tex, /Long cohort & 201--208 & 7\/16 & 7\/8 & 7\/8/);
    assert.match(tex, /Crossover & 209 & 1\/2 & 1\/1 & 0\/1/);
    assert.match(tex, /Short cohort & 210--212 & 3\/6 & 2\/3 & 3\/3/);
    assert.match(tex, /arm C completed before.*arm K after/);
    assert.doesNotMatch(tex, /entirely inside the post-shift regime/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("incomplete window control remains pending and never reports partial outcome counts", () => {
  const root = fixture(true);
  try {
    const tex = render(root);
    assert.match(tex, /PENDING \(23\/24/);
    assert.doesNotMatch(tex, /Long cohort &|Crossover &|Short cohort &/);
    assert.doesNotMatch(tex, /entirely inside the post-shift regime/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
