import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { resolve } from "node:path";
import { proseNumbers, proseOf, SOURCES } from "./paper-number-audit.js";

test("the documented relative-path command runs the prose audit", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/paper-number-audit.ts"], {
    cwd: resolve("."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /OK: every prose decimal, fraction and percentage/);
});

test("extracts prose numbers without treating paths or labels as claims", () => {
  const prose = proseOf("\\label{sec:study2} 14/40 and 9 of 40, $p=0.039$, 35\\% on \\texttt{file2.tex}");
  assert.deepEqual(proseNumbers(prose).sort(), ["0.039", "14/40", "35%", "9/40"].sort());
  assert.ok(SOURCES.includes("docs/arm-c-process-trace.md"));
});
