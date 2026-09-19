/** Offline tests for arm K's oracle-free code selector: node --import tsx scripts/ak-select.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { printfProbes, runCandidate, selectByMbrExec, selectBySignaturePlurality } from "./ak-select.ts";

const task = resolve("tasks/bench-printf-format");
const GOOD = `export function format(fmt: string, ...a: unknown[]): string { let i = 0; return fmt.replace(/%(.)/g, (_m, c) => (c === "%" ? "%" : String(a[i++]))); }\n`;
const BAD = `export function format(fmt: string, ...a: unknown[]): string { return "x"; }\n`;
const BROKEN = `export const nothing = 1;\n`;

function workspace(root: string, name: string, src: string) {
  const dir = join(root, name);
  cpSync(join(task, "public"), dir, { recursive: true });
  writeFileSync(join(dir, "format.ts"), src);
  return dir;
}

test("MBR-exec: agreement wins, null candidates get no vote and no score, ties/no-signal go to lowest index", () => {
  const a = ["1", "2", "3"], b = ["1", "2", "9"], c = ["7", "8", "9"];
  const s = selectByMbrExec([c, a, b, null]);
  assert.equal(s.winnerIndex, 2, "b agrees with a on 2 probes and with c on 1: the highest total");
  assert.deepEqual(s.scores, [1, 2, 3, null]);
  assert.equal(selectByMbrExec([a, a, c]).winnerIndex, 0, "ties break to the lowest index");
  assert.equal(selectByMbrExec([null, null]).winnerIndex, 0);
  assert.equal(selectBySignaturePlurality([a, c, a, null]).winnerIndex, 0);
  assert.deepEqual(selectBySignaturePlurality([a, c, a, null]).scores, [2, 1, 2, null]);
});

test("probes come from the public spec only and are deterministic", () => {
  const p = printfProbes();
  assert.ok(p.length > 1000 && p.length < 10000, String(p.length));
  assert.equal(JSON.stringify(p), JSON.stringify(printfProbes()));
});

test("selection runs with oracle/ and fixtures/ unreadable or absent, and the anti-tamper hash still covers them", () => {
  const tmp = mkdtempSync(join(tmpdir(), "ak-select-"));
  try {
    // A task copy whose oracle/ and fixtures/ are chmod 000: any read of them would throw EACCES.
    const locked = join(tmp, "locked");
    cpSync(task, locked, { recursive: true });
    const stubHash = (t: string) => {
      const stubDir = mkdtempSync(join(tmp, "stub-"));
      writeFileSync(join(stubDir, "claude"), "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'x',num_turns:1,duration_ms:1,total_cost_usd:0.001,usage:{input_tokens:1,output_tokens:1}})+'\\n');\n");
      chmodSync(join(stubDir, "claude"), 0o755);
      const root = join(tmp, `run-${Math.random().toString(36).slice(2)}`);
      const r = spawnSync(process.execPath, ["--import", "tsx", resolve("scripts/bench-rq1.ts"), t, "A", "1", "--root", root], { encoding: "utf8", env: { ...process.env, PATH: `${stubDir}${delimiter}${process.env.PATH}` }, timeout: 60000 });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      return JSON.parse(readFileSync(join(root, "result.json"), "utf8")).frozen.task_sha256 as string;
    };
    const hashBaseline = stubHash(locked);
    const hashFixtureChanged = (() => {
      const alt = join(tmp, "alt");
      cpSync(task, alt, { recursive: true });
      writeFileSync(join(alt, "fixtures", "correct", "format.ts"), "// changed\n");
      return stubHash(alt);
    })();
    const hashOracleChanged = (() => {
      const alt = join(tmp, "alt2");
      cpSync(task, alt, { recursive: true });
      writeFileSync(join(alt, "oracle", "oracle.json"), "{}\n");
      return stubHash(alt);
    })();
    assert.notEqual(hashFixtureChanged, hashBaseline, "fixtures/ is covered by the anti-tamper hash");
    assert.notEqual(hashOracleChanged, hashBaseline, "oracle/ is covered by the anti-tamper hash");

    chmodSync(join(locked, "oracle"), 0o000);
    chmodSync(join(locked, "fixtures"), 0o000);
    const ws = join(tmp, "ws");
    mkdirSync(ws);
    const dirs = [workspace(ws, "a1", GOOD), workspace(ws, "a2", BAD), workspace(ws, "a3", GOOD), workspace(ws, "a4", BROKEN)];
    const probes = printfProbes().slice(0, 40);
    const sigs = dirs.map((d) => runCandidate(d, probes));
    assert.equal(sigs[3], null, "a candidate without a format export gets no vote");
    const sel = selectByMbrExec(sigs);
    assert.equal(sel.winnerIndex, 0);
    assert.ok(sel.scores[0]! > sel.scores[1]!);
    // and with oracle/ and fixtures/ removed altogether
    chmodSync(join(locked, "oracle"), 0o755);
    chmodSync(join(locked, "fixtures"), 0o755);
    rmSync(join(locked, "oracle"), { recursive: true });
    rmSync(join(locked, "fixtures"), { recursive: true });
    assert.equal(selectByMbrExec(dirs.map((d) => runCandidate(d, probes))).winnerIndex, 0);
  } finally {
    for (const d of ["oracle", "fixtures"]) try { chmodSync(join(tmp, "locked", d), 0o755); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("a candidate that tries to shell out or dynamically require/import gets no vote, not an exception, and never actually runs the forbidden call", () => {
  const tmp = mkdtempSync(join(tmpdir(), "ak-select-danger-"));
  try {
    const marker = join(tmp, "ran-forbidden-code");
    const dangerous = join(tmp, "danger");
    cpSync(join(task, "public"), dangerous, { recursive: true });
    writeFileSync(
      join(dangerous, "format.ts"),
      `import { execSync } from "node:child_process";\nexecSync(${JSON.stringify("touch " )} + ${JSON.stringify(marker)});\nexport function format(fmt: string): string { return fmt; }\n`,
    );
    const sig = runCandidate(dangerous, printfProbes().slice(0, 5));
    assert.equal(sig, null, "the guard rejects the source before importing it: no signature, no vote");
    assert.equal(existsSync(marker), false, "the forbidden call never actually ran");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
