/** Offline contract tests for scripts/conv-forensics.ts: node --import tsx scripts/conv-forensics.test.ts
 * No real model, no real bench/results directory -- tiny fixture trees only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTask } from "./conv-forensics.ts";

function writeArmC(suiteDir: string, task: string, seed: number, answer: string) {
  const ws = join(suiteDir, `${task}-C-seed${seed}`, "workspace");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "answer.txt"), answer);
}

function writeArmK(armkDir: string, task: string, seed: number, normalizedAnswers: string[]) {
  const dir = join(armkDir, `${task}-K-seed${seed}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "result.json"), JSON.stringify({ task_id: task, seed, selection: { normalized_answers: normalizedAnswers } }));
}

test("conv-forensics: agrees when arm C's answer matches the K-attempt plurality", () => {
  const root = mkdtempSync(join(tmpdir(), "conv-forensics-"));
  const suiteDir = join(root, "rq1-suite");
  const armkDir = join(root, "rq1-arm-k");
  try {
    // Plurality is "42" (3 votes) vs "43" (2 votes); arm C also answers "42".
    writeArmK(armkDir, "stamp-interpreter", 1, ["42", "42", "42", "43", "43"]);
    writeArmC(suiteDir, "stamp-interpreter", 1, "42");

    const report = runTask(suiteDir, armkDir, "stamp-interpreter");
    assert.equal(report.compared, 1);
    assert.equal(report.agreeCount, 1);
    assert.equal(report.seeds[0].agree, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("conv-forensics: disagrees when arm C's answer is not the K-attempt plurality (this is the falsifiable case)", () => {
  const root = mkdtempSync(join(tmpdir(), "conv-forensics-"));
  const suiteDir = join(root, "rq1-suite");
  const armkDir = join(root, "rq1-arm-k");
  try {
    writeArmK(armkDir, "stamp-interpreter", 2, ["42", "42", "42", "43", "43"]);
    writeArmC(suiteDir, "stamp-interpreter", 2, "43");

    const report = runTask(suiteDir, armkDir, "stamp-interpreter");
    assert.equal(report.compared, 1);
    assert.equal(report.agreeCount, 0);
    assert.equal(report.seeds[0].agree, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("conv-forensics: normalizes whitespace/case identically on both sides before comparing", () => {
  const root = mkdtempSync(join(tmpdir(), "conv-forensics-"));
  const suiteDir = join(root, "rq1-suite");
  const armkDir = join(root, "rq1-arm-k");
  try {
    writeArmK(armkDir, "stamp-2", 3, ["  Foo   Bar  ", "  Foo   Bar  ", "baz"]);
    writeArmC(suiteDir, "stamp-2", 3, "foo bar\n");

    const report = runTask(suiteDir, armkDir, "stamp-2");
    assert.equal(report.seeds[0].agree, true, JSON.stringify(report.seeds[0]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("conv-forensics: a seed with no committed arm-C answer is excluded from the rate, not counted as disagreement", () => {
  const root = mkdtempSync(join(tmpdir(), "conv-forensics-"));
  const suiteDir = join(root, "rq1-suite");
  const armkDir = join(root, "rq1-arm-k");
  try {
    writeArmK(armkDir, "stamp-interpreter", 4, ["42", "42"]);
    // No arm-C directory written for seed 4 at all.

    const report = runTask(suiteDir, armkDir, "stamp-interpreter");
    assert.equal(report.compared, 0);
    assert.equal(report.agreeCount, 0);
    assert.equal(report.seeds[0].agree, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("conv-forensics: pooled rate across two seeds is agree/compared, not an average of per-seed booleans mis-weighted", () => {
  const root = mkdtempSync(join(tmpdir(), "conv-forensics-"));
  const suiteDir = join(root, "rq1-suite");
  const armkDir = join(root, "rq1-arm-k");
  try {
    writeArmK(armkDir, "stamp-2", 10, ["a", "a", "b"]);
    writeArmC(suiteDir, "stamp-2", 10, "a");
    writeArmK(armkDir, "stamp-2", 11, ["a", "a", "b"]);
    writeArmC(suiteDir, "stamp-2", 11, "b");

    const report = runTask(suiteDir, armkDir, "stamp-2");
    assert.equal(report.compared, 2);
    assert.equal(report.agreeCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
