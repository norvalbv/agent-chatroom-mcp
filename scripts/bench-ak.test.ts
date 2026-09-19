/** Offline contract tests for the A-k comparison arm: node --import tsx scripts/bench-ak.test.ts
 * No real model is ever invoked — same stub-`claude`-on-PATH pattern as scripts/bench-rq1.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve, join } from "node:path";
import { selectByMajorityVote, runAttempt } from "./bench-ak.ts";

const runner = resolve("scripts/bench-ak.ts");
const task = resolve("tasks/bench-fact-check");
const codeTask = resolve("tasks/bench-bug-fix");
const EXPECTED = "Society for Formal Methods, Vienna";
const WRONG = "Institute for Computational Reasoning, Berlin";

function invoke(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", runner, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 60000 });
}

/** Stub `claude`: writes an answer to answer.txt in its cwd. When STUB_MINORITY_ATTEMPT is set, the
 * attempt whose cwd path contains "attempt-<N>" for that N writes WRONG instead of the default answer —
 * lets one integration test exercise a real (not unanimous) majority vote end-to-end. */
function stubClaudeDir() {
  const dir = mkdtempSync(join(tmpdir(), "bench-ak-stub-"));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    [
      "#!/usr/bin/env node",
      "const fs=require('node:fs');",
      "const cwd=process.cwd();",
      "const minority=process.env.STUB_MINORITY_ATTEMPT;",
      `const isMinority = minority && cwd.includes('attempt-'+minority+'/');`,
      `fs.writeFileSync('answer.txt', isMinority ? ${JSON.stringify(WRONG)} : ${JSON.stringify(EXPECTED)});`,
      "process.stdout.write(JSON.stringify({type:'assistant',message:{usage:{input_tokens:80,output_tokens:15}}})+'\\n');",
      "process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'seat done',num_turns:2,duration_ms:500,duration_api_ms:400,total_cost_usd:0.002,usage:{input_tokens:100,output_tokens:20}})+'\\n');",
      "",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  return dir;
}

function writeArmCResult(dir: string, costUsd: number, wallClockMs: number) {
  const p = join(dir, "arm-c-result.json");
  writeFileSync(p, JSON.stringify({ usage: { cost_usd: costUsd }, wall_clock: { duration_ms: wallClockMs } }));
  return p;
}

test("selectByMajorityVote: plain majority wins, ties break to lowest index, all-null breaks to index 0", () => {
  const majority = selectByMajorityVote([EXPECTED, WRONG, EXPECTED]);
  assert.equal(majority.winnerIndex, 0);
  assert.equal(majority.votes[majority.normalized[0]!], 2);

  const tie = selectByMajorityVote(["a", "b"]);
  assert.equal(tie.winnerIndex, 0, "tie breaks to the lowest sub-seed index");

  const noSignal = selectByMajorityVote([null, null, null]);
  assert.equal(noSignal.winnerIndex, 0, "no attempt produced an answer: falls back to index 0, not a random pick");

  const normalizes = selectByMajorityVote(["  SOCIETY for FORMAL methods,  Vienna\n", EXPECTED, WRONG]);
  assert.equal(normalizes.winnerIndex, 0, "normalized equality, not raw string equality, decides the vote");
});

test("refuses a task whose oracle kind has no oracle-free selector rather than silently building an oracle-informed pick", () => {
  const root = join(tmpdir(), `bench-ak-code-refuse-${process.pid}`);
  const armCPath = writeArmCResult(tmpdir(), 0.5, 100000);
  try {
    const r = invoke([codeTask, "3", "1", "--root", root, "--arm-c-result", armCPath]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no oracle-free selector/);
    assert.equal(existsSync(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses root reuse and a k below 2", () => {
  const armCPath = writeArmCResult(tmpdir(), 0.5, 100000);
  const reused = mkdtempSync(join(tmpdir(), "bench-ak-reuse-"));
  try {
    const r1 = invoke([task, "3", "1", "--root", reused, "--arm-c-result", armCPath]);
    assert.notEqual(r1.status, 0);
    assert.match(r1.stderr, /refusing.*reuse/i);
    const root2 = join(tmpdir(), `bench-ak-badk-${process.pid}`);
    const r2 = invoke([task, "1", "1", "--root", root2, "--arm-c-result", armCPath]);
    assert.notEqual(r2.status, 0);
    assert.equal(existsSync(root2), false);
  } finally {
    rmSync(reused, { recursive: true, force: true });
  }
});

test("k=3, unanimous correct answers: majority selects a task_pass, cost/turns summed across all 3 attempts", () => {
  const stubDir = stubClaudeDir();
  const root = join(tmpdir(), `bench-ak-unanimous-${process.pid}-${Date.now()}`);
  const armCPath = writeArmCResult(tmpdir(), 0.3, 200000);
  try {
    const r = invoke([task, "3", "7", "--root", root, "--arm-c-result", armCPath], { PATH: `${stubDir}${delimiter}${process.env.PATH}` });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(result.arm, "K");
    assert.equal(result.k, 3);
    assert.equal(result.outcome, "task_pass");
    assert.equal(result.passed, true);
    assert.equal(result.attempts.length, 3);
    assert.ok(Math.abs(result.usage.cost_usd - 0.006) < 1e-9, "cost_usd_total must sum all 3 attempts (0.002 each), not just the winner's");
    assert.equal(result.turns_total, 6, "turns_total must sum all 3 attempts (2 each)");
    assert.ok(Math.abs(result.budget.attempt_cap_usd - 0.3) < 1e-9, "default cap is the flat settled 0.30 USD, independent of k or arm C's cost");
    assert.equal(result.budget.attempt_deadline_ms, 150000, "default deadline is the flat settled 150 s");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("k=3, one minority attempt disagrees: majority vote still selects the winning (2-of-3) answer", () => {
  const stubDir = stubClaudeDir();
  const root = join(tmpdir(), `bench-ak-majority-${process.pid}-${Date.now()}`);
  const armCPath = writeArmCResult(tmpdir(), 0.3, 200000);
  try {
    const r = invoke([task, "3", "9", "--root", root, "--arm-c-result", armCPath], { PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_MINORITY_ATTEMPT: "2" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(result.selection.winner_attempt, 1, "attempt 1 (not the minority attempt 2) is the lowest-index attempt matching the 2-of-3 majority answer");
    assert.equal(result.outcome, "task_pass");
    assert.equal(result.attempts[1].answer.trim(), "Institute for Computational Reasoning, Berlin", "attempt 2 really did submit the minority (wrong) answer");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("refuses when --arm-c-result has no positive cost/wall-clock to match from", () => {
  const root = join(tmpdir(), `bench-ak-nomatch-${process.pid}`);
  const armCPath = writeArmCResult(tmpdir(), 0, 0);
  try {
    const r = invoke([task, "3", "1", "--root", root, "--arm-c-result", armCPath]);
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- code task (printf-format), selector, concurrency, kill safety ----
// The selector itself (MBR-exec primary, signature-plurality exploratory, oracle/fixtures unreadable-or-absent
// proof, forbidden-source guard) is scripts/ak-select.test.ts's job; these tests exercise bench-ak.ts's own
// wiring end to end (dispatch by oracle.kind, concurrency, kill safety, resume, cost accounting).
import { pool } from "./bench-ak.ts";
import { chmodSync as chmod, cpSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";

const printfTask = resolve("tasks/bench-printf-format");
const correctImpl = readFileSync(join(printfTask, "fixtures/correct/format.ts"), "utf8");
const constantImpl = "export function format(fmt: string, ...args: unknown[]): string { return fmt; }\n";
const otherWrongImpl = "export function format(fmt: string, ...args: unknown[]): string { return String(args[0]); }\n";

/** Stub `claude` for code tasks: STUB_IMPLS is a JSON map attempt-number -> implementation source; it also
 * appends "<attempt> start/end" lines with timestamps to STUB_LOG for concurrency measurements. */
function stubCodeClaudeDir() {
  const dir = mkdtempSync(join(tmpdir(), "bench-ak-code-stub-"));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    [
      "#!/usr/bin/env node",
      "const fs=require('node:fs');",
      "const m=process.cwd().match(/attempt-(\\d+)/);const n=m?m[1]:'0';",
      "const impls=JSON.parse(process.env.STUB_IMPLS||'{}');",
      "if(process.env.STUB_LOG)fs.appendFileSync(process.env.STUB_LOG,n+' start '+Date.now()+'\\n');",
      "if(process.env.STUB_TAMPER)fs.appendFileSync(process.env.STUB_TAMPER,'\\n');",
      "if(impls[n]!==undefined)fs.writeFileSync('format.ts',impls[n]);",
      "setTimeout(()=>{",
      "if(process.env.STUB_LOG)fs.appendFileSync(process.env.STUB_LOG,n+' end '+Date.now()+'\\n');",
      "process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'done',num_turns:2,duration_ms:500,duration_api_ms:400,total_cost_usd:0.002,usage:{input_tokens:100,output_tokens:20}})+'\\n');",
      "},Number(process.env.STUB_SLEEP_MS||0));",
      "",
    ].join("\n"),
  );
  chmod(bin, 0o755);
  return dir;
}

test("bench-ak.ts's selectPrintf call sites never reference oracle/, fixtures/ or a task directory (ak-select.test.ts proves the selector functions themselves are oracle-free)", () => {
  const ak = readFileSync(resolve("scripts/bench-ak.ts"), "utf8");
  const selectorSrc = ak.slice(ak.indexOf("function selectPrintf"), ak.indexOf("function runAttempt"));
  assert.doesNotMatch(selectorSrc, /oracle|fixtures|taskDir/i, "bench-ak's printf selector wiring never touches the task dir");
});

test("printf group end-to-end: MBR-exec selects the agreeing cluster, scored by the oracle only afterwards; anti-tamper hash still covers oracle/ and fixtures/", () => {
  const stubDir = stubCodeClaudeDir();
  // Inside the repo: the oracle scorer resolves tsx from its own location, so a copy under /tmp cannot be scored.
  const work = mkdtempSync(resolve(".bench-ak-test-"));
  const taskCopy = join(work, "bench-printf-format");
  const armCPath = writeArmCResult(work, 0.6, 100000);
  try {
    cpSync(printfTask, taskCopy, { recursive: true });
    const impls = JSON.stringify({ 1: constantImpl, 2: correctImpl, 3: correctImpl, 4: otherWrongImpl });
    const root = join(work, "run");
    const r = invoke([taskCopy, "4", "5", "--root", root, "--arm-c-result", armCPath, "--concurrency", "2"], { PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_IMPLS: impls });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const res = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(res.selector, "mbr-exec");
    assert.equal(res.selection.winner_attempt, 2, "attempts 2 and 3 agree; lowest index of the modal cluster wins");
    assert.equal(res.passed, true, "the selected attempt is the correct implementation");
    assert.deepEqual(res.attempts.map((a: { passed: boolean }) => a.passed), [false, true, true, false]);
    assert.equal(res.oracle_ceiling.any_attempt_passed, true);
    assert.equal(res.oracle_ceiling.n_passed, 2);
    const hashes = new Set<string>();
    for (const a of res.attempts) {
      const att = JSON.parse(readFileSync(join(a.root, "result.json"), "utf8"));
      assert.equal(att.anti_tamper.unchanged, true);
      hashes.add(att.anti_tamper.hash_before);
    }
    assert.equal(hashes.size, 1, "every attempt froze the same task tree hash");
    // The hash covers oracle/ and fixtures/: altering either changes what the runner records.
    const root2 = join(work, "run2");
    const before = [...hashes][0];
    writeFileSync(join(taskCopy, "fixtures", "correct", "extra.txt"), "x");
    const r2 = invoke([taskCopy, "2", "6", "--root", root2, "--arm-c-result", armCPath], { PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_IMPLS: impls });
    assert.equal(r2.status, 0, r2.stderr + r2.stdout);
    const att = JSON.parse(readFileSync(join(root2, "attempt-1", "result.json"), "utf8"));
    assert.notEqual(att.anti_tamper.hash_before, before, "a fixtures/ change changes the frozen hash");
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("--concurrency bounds attempts in flight (and runs them in parallel); every attempt still finishes", () => {
  const stubDir = stubCodeClaudeDir();
  const work = mkdtempSync(join(tmpdir(), "bench-ak-conc-"));
  const armCPath = writeArmCResult(work, 0.6, 100000);
  const log = join(work, "log.txt");
  try {
    const r = invoke([printfTask, "6", "3", "--root", join(work, "run"), "--arm-c-result", armCPath, "--concurrency", "3"], { PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_LOG: log, STUB_SLEEP_MS: "1500", STUB_IMPLS: JSON.stringify({ 1: correctImpl }) });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    let live = 0;
    let peak = 0;
    const events = readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" ")).sort((a, b) => Number(a[2]) - Number(b[2]) || (a[1] === "end" ? -1 : 1));
    for (const [, kind] of events) {
      live += kind === "start" ? 1 : -1;
      peak = Math.max(peak, live);
    }
    assert.equal(events.filter((e) => e[1] === "end").length, 6);
    assert.ok(peak >= 2 && peak <= 3, `peak concurrent attempts ${peak} must be within 2..3`);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("pool never exceeds its limit", async () => {
  let live = 0;
  let peak = 0;
  await pool(9, 4, async () => {
    peak = Math.max(peak, ++live);
    await new Promise((ok) => setTimeout(ok, 10));
    live--;
  });
  assert.equal(peak, 4);
});

test("a killed or missing attempt stays in the group as a null vote; its unknown cost is bounded by the cap, never summed as zero", () => {
  const stubDir = stubCodeClaudeDir();
  const work = mkdtempSync(join(tmpdir(), "bench-ak-null-"));
  const armCPath = writeArmCResult(work, 0.6, 100000);
  try {
    // Attempt 2 outlives the 2 s deadline: bench-rq1 kills it (timeout, usage null).
    const stubSlow = join(stubDir, "claude");
    const orig = readFileSync(stubSlow, "utf8");
    writeFileSync(stubSlow, orig.replace("Number(process.env.STUB_SLEEP_MS||0)", "(n==='2'?60000:0)"));
    const r = invoke([printfTask, "3", "8", "--root", join(work, "run"), "--arm-c-result", armCPath, "--attempt-deadline-ms", "2000", "--concurrency", "3"], { PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_IMPLS: JSON.stringify({ 1: correctImpl, 2: correctImpl, 3: correctImpl }) });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const res = JSON.parse(readFileSync(join(work, "run", "result.json"), "utf8"));
    assert.equal(res.attempts.length, 3);
    assert.equal(res.attempts[1].outcome, "timeout");
    assert.equal(res.attempts[1].passed, false);
    assert.equal(res.usage.cost_usd, null, "unknown cost is null, not a sum that treats it as 0");
    assert.equal(res.usage.cost_usd_unknown_attempts, 1);
    assert.ok(Math.abs(res.usage.cost_usd_known_sum - 0.004) < 1e-9);
    assert.ok(Math.abs(res.usage.cost_usd_upper_bound - (0.004 + 0.3)) < 1e-9, "upper bound adds the default 0.30 USD cap for the unknown attempt");
    assert.equal(res.passed, true, "the surviving agreeing attempts still submit a passing answer");
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("--resume re-runs no finished attempt and re-runs a partial one", () => {
  const stubDir = stubCodeClaudeDir();
  const work = mkdtempSync(join(tmpdir(), "bench-ak-resume-"));
  const armCPath = writeArmCResult(work, 0.6, 100000);
  const root = join(work, "run");
  const env = { PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_IMPLS: JSON.stringify({ 1: correctImpl, 2: correctImpl, 3: correctImpl }) };
  try {
    assert.equal(invoke([printfTask, "3", "4", "--root", root, "--arm-c-result", armCPath], env).status, 0);
    const mtime = readFileSync(join(root, "attempt-1", "result.json"), "utf8");
    rmSync(join(root, "attempt-3", "result.json"));
    rmSync(join(root, "result.json"));
    const r = invoke([printfTask, "3", "4", "--root", root, "--arm-c-result", armCPath, "--resume"], env);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const res = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.deepEqual(res.resumed_attempts, [1, 2]);
    assert.equal(readFileSync(join(root, "attempt-1", "result.json"), "utf8"), mtime);
    assert.ok(readdirSync(root).some((n) => n.startsWith("attempt-3.partial-")));
    assert.equal(invoke([printfTask, "3", "4", "--root", root, "--arm-c-result", armCPath], env).status, 1, "no --resume: root reuse refused");
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("orphans: SIGTERM to bench-ak.ts kills every attempt runner and the claude under it", async () => {
  const stubDir = mkdtempSync(join(tmpdir(), "bench-ak-orphan-"));
  const pidFile = join(stubDir, "pids");
  writeFileSync(join(stubDir, "claude"), `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(pidFile)},process.pid+'\\n');setInterval(()=>{},1000);\n`);
  chmod(join(stubDir, "claude"), 0o755);
  const armCPath = writeArmCResult(stubDir, 0.6, 100000);
  const child = spawn(process.execPath, ["--import", "tsx", runner, printfTask, "4", "2", "--root", join(stubDir, "run"), "--arm-c-result", armCPath, "--concurrency", "4"], { env: { ...process.env, PATH: `${stubDir}${delimiter}${process.env.PATH}` }, stdio: "ignore" });
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !(existsSync(pidFile) && readFileSync(pidFile, "utf8").trim().split("\n").length >= 4)) await new Promise((ok) => setTimeout(ok, 100));
    const pids = readFileSync(pidFile, "utf8").trim().split("\n").map(Number);
    assert.equal(pids.length, 4, "four stub claudes running");
    child.kill("SIGTERM");
    await new Promise((ok) => child.once("exit", ok));
    await new Promise((ok) => setTimeout(ok, 500));
    for (const pid of pids) {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      assert.equal(alive, false, `stub claude ${pid} must die with the parent`);
    }
  } finally {
    child.kill("SIGKILL");
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("runAttempt: an outer timeout kills a wedged runner (one that never exits even though the claude under it is quiet) and resolves as a runner failure, not a hang", async () => {
  const stubDir = mkdtempSync(join(tmpdir(), "bench-ak-wedge-"));
  const wedgedRunner = join(stubDir, "wedged-runner.mjs");
  const pidFile = join(stubDir, "pid");
  // Simulates bench-rq1.ts itself wedging (e.g. stalled before spawning claude, or a pipe that never
  // closes): the process just never exits, unlike a killed claude seat which bench-rq1.ts's own
  // --deadline-ms already handles.
  writeFileSync(wedgedRunner, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  const start = Date.now();
  const result = await runAttempt(wedgedRunner, [], 500);
  const elapsed = Date.now() - start;
  try {
    assert.equal(result.status, null, "a wedged runner never exits cleanly, so status is null, exactly like any other runner failure");
    assert.match(result.stderr, /outer timeout/);
    assert.ok(elapsed < 5000, `outer timeout must actually bound the wait (took ${elapsed} ms for a 500 ms timeout)`);
    const pid = Number(readFileSync(pidFile, "utf8"));
    await new Promise((ok) => setTimeout(ok, 300));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, "the wedged process itself must be killed, not just abandoned");
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("a single wedged attempt does not deadlock the pool: the group still finishes within the outer timeout, with the wedged attempt as a null vote", () => {
  const stubDir = stubCodeClaudeDir();
  const work = mkdtempSync(join(tmpdir(), "bench-ak-wedgepool-"));
  const armCPath = writeArmCResult(work, 0.6, 100000);
  // A stub stand-in for bench-rq1.ts itself wedging (stalled before spawning claude, or a pipe that never
  // closes) rather than the claude seat under it hanging (which bench-rq1.ts's own --deadline-ms already
  // catches): it ignores its args and simply never exits.
  const wedgedRunner = join(stubDir, "wedged-runner.mjs");
  writeFileSync(wedgedRunner, "setInterval(() => {}, 1000);\n");
  const realRunner = resolve("scripts/bench-rq1.ts");
  // A dispatcher runner: attempt 2 (sub-seed suffix) goes to the wedged stand-in, the rest to the real one.
  const dispatchRunner = join(stubDir, "dispatch-runner.mjs");
  writeFileSync(
    dispatchRunner,
    `import { spawnSync } from "node:child_process";
const seed = process.argv[4];
const target = seed.endsWith("2") ? ${JSON.stringify(wedgedRunner)} : ${JSON.stringify(realRunner)};
const r = spawnSync(process.execPath, ["--import", "tsx", target, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
`,
  );
  try {
    const start = Date.now();
    const r = invoke(
      [printfTask, "3", "9", "--root", join(work, "run"), "--arm-c-result", armCPath, "--runner", dispatchRunner, "--attempt-deadline-ms", "1000", "--concurrency", "3"],
      { PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_IMPLS: JSON.stringify({ 1: correctImpl, 3: correctImpl }) },
    );
    const elapsed = Date.now() - start;
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(elapsed < 40000, `the group must finish within the outer timeout (1000 ms deadline + 30000 ms slack), not hang forever (took ${elapsed} ms)`);
    const res = JSON.parse(readFileSync(join(work, "run", "result.json"), "utf8"));
    assert.equal(res.attempts.length, 3);
    assert.equal(res.attempts[1].outcome, "no_result");
    assert.ok(res.attempts[1].runner_failure, "the wedged attempt is recorded as a runner failure, still present as a null vote");
    assert.match(res.attempts[1].runner_failure, /outer timeout/);
    assert.equal(res.passed, true, "the two healthy attempts still let the group pass");
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});
