import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { proseNumbers, proseOf, SOURCES } from "./paper-number-audit.js";

test("the documented relative-path command runs the prose audit", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/paper-number-audit.ts"], {
    cwd: resolve("."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /OK: every prose decimal, fraction and percentage/);
});

test("the prose audit runs through a symlink to the script", () => {
  const fixture = mkdtempSync(join(tmpdir(), "paper-number-audit-link-"));
  try {
    const link = join(fixture, "paper-number-audit.ts");
    symlinkSync(resolve("scripts/paper-number-audit.ts"), link);
    const result = spawnSync(process.execPath, ["--import", "tsx", link], {
      cwd: resolve("."),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /OK: every prose decimal, fraction and percentage/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("an unsupported section number makes the prose audit fail", () => {
  const fixture = mkdtempSync(join(tmpdir(), "paper-number-audit-failure-"));
  try {
    mkdirSync(join(fixture, "scripts"));
    mkdirSync(join(fixture, "paper", "sections"), { recursive: true });
    const script = join(fixture, "scripts", "paper-number-audit.ts");
    copyFileSync(resolve("scripts/paper-number-audit.ts"), script);
    writeFileSync(join(fixture, "paper", "sections", "fixture.tex"), "Unsupported value: 0.123456789\n");
    const result = spawnSync(process.execPath, ["--import", "tsx", script], {
      cwd: resolve("."),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /fixture\.tex: 0\.123456789/);
    assert.match(result.stderr, /FAIL: 1 prose number\(s\) not found/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("extracts prose numbers without treating paths or labels as claims", () => {
  const prose = proseOf("\\label{sec:study2} 14/40 and 9 of 40, $p=0.039$, 35\\% on \\texttt{file2.tex}");
  assert.deepEqual(proseNumbers(prose).sort(), ["0.039", "14/40", "35%", "9/40"].sort());
  assert.ok(SOURCES.includes("docs/arm-c-process-trace.md"));
});
