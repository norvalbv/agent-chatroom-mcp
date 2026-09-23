/** Offline tests for the step-(c) adjudicator trial: node --import tsx scripts/adjudicator-trial.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildPrompt, CASES, parseVerdict, score } from "./adjudicator-trial.ts";

const readme = readFileSync("tasks/bench-printf-format/public/README.md", "utf8");

test("expected outputs come from the C library's printf, and the control's right answer is the short one", () => {
  for (const c of CASES) {
    const [, fmt, x] = c.call.match(/format\("([^"]+)", ([^)]+)\)/)!;
    const r = spawnSync("printf", [fmt, x], { encoding: "utf8" });
    if (r.status !== 0) continue; // no printf binary: nothing independent to compare with
    assert.equal(r.stdout, c.right, c.id);
    assert.notEqual(c.right, c.wrong);
  }
  const control = CASES.find((c) => c.id.includes("control"))!;
  assert.ok(control.right.length < control.wrong.length, "a judge biased to long exact digits must fail the control");
});

test("the prompt shows both outputs once, swaps with order, and holds nothing but the public README", () => {
  const c = CASES[0];
  const a = buildPrompt(readme, c, true), b = buildPrompt(readme, c, false);
  assert.ok(a.includes(`Implementation A outputs: ${c.right}\nImplementation B outputs: ${c.wrong}`));
  assert.ok(b.includes(`Implementation A outputs: ${c.wrong}\nImplementation B outputs: ${c.right}`));
  assert.ok(a.startsWith(`Below is a specification.\n\n${readme.trimEnd()}\n\n`));
  assert.ok(!/oracle|fixture/i.test(a.slice(readme.length)));
});

test("verdict parsing takes the last FINAL line, tolerates bold, and never counts a missing verdict as right", () => {
  assert.equal(parseVerdict("... FINAL: A is tempting\nFINAL: B\n"), "B");
  assert.equal(parseVerdict("reasoning\n**FINAL: A**"), "A");
  assert.equal(parseVerdict("FINAL: A\nlater\nFINAL: B"), "B");
  assert.equal(parseVerdict("I think A."), null);
  assert.equal(score(null, true), false);
  assert.equal(score(null, false), false);
  assert.equal(score("A", true), true);
  assert.equal(score("B", false), true);
  assert.equal(score("A", false), false);
});
