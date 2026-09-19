/** Offline contract tests for the RQ1 harness mode: node --import tsx scripts/bench-rq1.test.ts
 * No real model is ever invoked — a stub `claude` executable stands in for it (pattern:
 * scripts/claude-usage-regression.ts), and arm C uses a stub hub (pattern: scripts/bench-harness.test.ts's
 * fixture) that concludes the room immediately on create, decoupled from what the stub seats do.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve, join } from "node:path";
import { createServer } from "node:net";

const runner = resolve("scripts/bench-rq1.ts");
const task = resolve("tasks/bench-fact-check");
const EXPECTED = "Society for Formal Methods, Vienna";

function invoke(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", runner, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 30000 });
}

/** A stub `claude` on PATH: requires --output-format stream-json --verbose (the real CLI's contract for
 * a --print run whose stdout is NDJSON, one event per line — bench-rq1.ts item 3), echoes one
 * `type:"assistant"` usage event, then a canned `type:"result"` line with usage/num_turns/duration_ms.
 * "kill" behavior instead sleeps after the assistant event so the harness's own deadline timer has to
 * SIGTERM it, with no `result` line ever emitted — proving usage/outcome recording survives a kill. */
function stubClaudeDir(behavior: "answer" | "no-answer" | "edit-file" | "kill" = "answer") {
  const dir = mkdtempSync(join(tmpdir(), "bench-rq1-stub-"));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    [
      "#!/usr/bin/env node",
      "const fs=require('node:fs');",
      "const args=process.argv.slice(2);",
      "if(!args.includes('--output-format')||args[args.indexOf('--output-format')+1]!=='stream-json'||!args.includes('--verbose')){process.stderr.write('expected --output-format stream-json --verbose\\n');process.exit(1);}",
      `const behavior=process.env.STUB_BEHAVIOR||'answer';`,
      `if(behavior==='answer')fs.writeFileSync('answer.txt',process.env.STUB_ANSWER||${JSON.stringify(EXPECTED)});`,
      "process.stdout.write(JSON.stringify({type:'assistant',message:{usage:{input_tokens:80,output_tokens:15,cache_read_input_tokens:10,cache_creation_input_tokens:5}}})+'\\n');",
      "if(behavior==='kill'){setInterval(()=>{},1000);}else{",
      "process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'seat done',num_turns:3,duration_ms:842,duration_api_ms:910,total_cost_usd:0.0041,usage:{input_tokens:120,cache_read_input_tokens:40,cache_creation_input_tokens:12,output_tokens:30}})+'\\n');",
      "}",
      "",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  return dir;
}

async function freePort() {
  const base = 20000 + ((process.pid * 2654435761) % 20000);
  for (let p = base; p < Math.min(base + 400, 65000); p += 1) {
    const s = createServer();
    try {
      await new Promise<void>((ok, no) => {
        s.once("error", no);
        s.listen(p, "127.0.0.1", ok);
      });
      return p;
    } catch {
    } finally {
      await new Promise<void>((ok) => s.close(() => ok()));
    }
  }
  throw new Error("no free test port");
}

function stubHubDir(text = EXPECTED) {
  const dir = mkdtempSync(join(tmpdir(), "bench-rq1-hub-"));
  const entry = join(dir, "hub.mjs");
  writeFileSync(
    entry,
    `import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const data=process.env.CHATROOM_DATA_DIR;
const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');
 if(req.method==='POST'&&req.url.endsWith('/create')){let b='';req.on('data',c=>b+=c);req.on('end',()=>{
  const room=req.url.split('/')[2];fs.mkdirSync(data,{recursive:true});
  fs.writeFileSync(path.join(data,room+'.jsonl'),JSON.stringify({type:'state',room,state:'concluded',conclusion:{text:${JSON.stringify(text)},decidedAt:new Date().toISOString()}})+'\\n');
  res.end('{}');});return;}
 if(req.url==='/rooms'){res.end(JSON.stringify({rooms:[],version:'stub-hub-v1'}));return;}
 res.end('{}');});
server.listen(Number(process.env.PORT),'127.0.0.1');`,
  );
  return entry;
}

test("runner exists", () => assert.ok(existsSync(runner), "scripts/bench-rq1.ts must exist"));

test("refuses an unknown arm and a non-integer seed", () => {
  const root = join(tmpdir(), `bench-rq1-badarm-${process.pid}`);
  const r1 = invoke([task, "Z", "1", "--root", root]);
  assert.notEqual(r1.status, 0);
  assert.equal(existsSync(root), false);
  const r2 = invoke([task, "A", "notanumber", "--root", root]);
  assert.notEqual(r2.status, 0);
});

test("refuses root reuse", () => {
  const root = mkdtempSync(join(tmpdir(), "bench-rq1-reuse-"));
  writeFileSync(join(root, "sentinel"), "keep");
  try {
    const r = invoke([task, "A", "1", "--root", root]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /refusing.*reuse/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("arm A: single seat, no mcp tools, writes answer.txt, records usage/turns/argv, scores task_pass", () => {
  const stubDir = stubClaudeDir();
  const root = join(tmpdir(), `bench-rq1-a-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "A", "1", "--root", root, "--model", "sonnet"], { PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_BEHAVIOR: "answer" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(result.arm, "A");
    assert.equal(result.seed, 1);
    assert.equal(result.model, "sonnet");
    assert.equal(result.outcome, "task_pass");
    assert.equal(result.passed, true);
    assert.equal(result.seats.length, 1);
    assert.equal(result.turns.summed, 3);
    assert.equal(result.usage.coverage, "complete");
    assert.ok(Math.abs(result.usage.cost_usd - 0.0041) < 1e-9);
    assert.equal(result.usage.input_tokens, 120);
    assert.equal(result.usage.cache_read_input_tokens, 40);
    assert.equal(result.usage.output_tokens, 30);
    assert.equal(result.seats[0].text, "seat done", "the seat's final response text is kept alongside the scored outcome");
    const argv: string[] = result.seats[0].argv;
    assert.ok(argv.includes("--output-format"));
    assert.ok(!argv.some((a) => a.includes("mcp__chatroom")), "arm A must not carry chatroom mcp tools");
    const mcpConfig = JSON.parse(readFileSync(join(root, "mcp-empty.json"), "utf8"));
    assert.deepEqual(mcpConfig, { mcpServers: {} });
    assert.ok(Number.isFinite(Date.parse(result.wall_clock.started_at)));
    assert.ok(result.wall_clock.duration_ms >= 0);
    assert.equal(result.budget.deadline_ms, 900000, "item 4: default deadline raised from 300000ms, sized from bug-fix-C-seed1's 139s reveal-alone evidence (paper/amendments.md)");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("arm A: --max-budget-usd is forwarded to the claude CLI argv and recorded in the result", () => {
  const stubDir = stubClaudeDir();
  const root = join(tmpdir(), `bench-rq1-budget-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "A", "1", "--root", root, "--max-budget-usd", "0.05"], { PATH: `${stubDir}${delimiter}${process.env.PATH}` });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    const argv: string[] = result.seats[0].argv;
    const i = argv.indexOf("--max-budget-usd");
    assert.ok(i >= 0 && argv[i + 1] === "0.05");
    assert.equal(result.budget.max_budget_usd, 0.05);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("arm A: no answer.txt written is parse_failure, not a crash, and usage is never zero-filled when the stub reports none", () => {
  const stubDir = stubClaudeDir();
  const root = join(tmpdir(), `bench-rq1-noans-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "A", "2", "--root", root], { PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_BEHAVIOR: "no-answer" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(result.outcome, "parse_failure");
    assert.equal(result.passed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("arm A: a seat killed at the deadline is recorded outcome timeout, not scored task_pass, and keeps whatever partial usage streamed before the kill (item 3)", () => {
  const stubDir = stubClaudeDir("kill");
  const root = join(tmpdir(), `bench-rq1-kill-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "A", "3", "--root", root, "--deadline-ms", "500"], { PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_BEHAVIOR: "kill" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(result.outcome, "timeout", "a killed seat must not be scored as if it completed");
    assert.equal(result.passed, false);
    assert.equal(result.seats[0].killed_by_deadline, true);
    assert.equal(result.seats[0].exit_code, null, "SIGTERM leaves exit_code null (a signal, not a code)");
    assert.equal(result.seats[0].signal, "SIGTERM");
    assert.equal(result.usage.coverage, "none", "unknown cost is never zero-filled into the rollup");
    assert.equal(result.usage.cost_usd, 0);
    assert.ok(result.seats[0].partial_usage, "the assistant event streamed before the kill must survive it");
    assert.equal(result.seats[0].partial_usage.output_tokens, 15);
    assert.equal(result.seats[0].partial_usage.assistant_messages_observed, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("arm C: hub boot failure still writes a result.json (infrastructure_error), never crashes with no artifact", async () => {
  const stubDir = stubClaudeDir();
  const missingHub = join(tmpdir(), `bench-rq1-missing-hub-${process.pid}.mjs`);
  const port = await freePort();
  const root = join(tmpdir(), `bench-rq1-hubfail-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "C", "1", "--root", root, "--port", String(port), "--seats", "1", "--hub-entry", missingHub, "--timeout-ms", "3000"], {
      PATH: `${stubDir}${delimiter}${process.env.PATH}`,
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(result.outcome, "infrastructure_error");
    assert.equal(result.passed, false);
    assert.ok(result.error, "the failure reason is recorded, not silently swallowed");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("arm C: N stub seats join a stub hub that concludes immediately; conclusion text becomes answer.txt; usage sums across seats", async () => {
  const stubDir = stubClaudeDir();
  const hubEntry = stubHubDir(EXPECTED);
  const port = await freePort();
  const root = join(tmpdir(), `bench-rq1-c-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "C", "1", "--root", root, "--port", String(port), "--seats", "2", "--hub-entry", hubEntry, "--timeout-ms", "10000"], {
      PATH: `${stubDir}${delimiter}${process.env.PATH}`,
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(result.arm, "C");
    assert.equal(result.outcome, "task_pass");
    assert.equal(result.seats.length, 2);
    assert.equal(result.frozen.seats, 2);
    assert.ok(Math.abs(result.usage.cost_usd - 0.0082) < 1e-6, `expected ~2x0.0041, got ${result.usage.cost_usd}`);
    assert.equal(result.usage.seats_with_usage, 2);
    assert.equal(readFileSync(join(root, "workspace", "answer.txt"), "utf8"), EXPECTED);
    for (const seat of result.seats) assert.ok(seat.argv.some((a: string) => a.includes("mcp__chatroom")), "arm C seats must carry chatroom mcp tools");
    assert.equal(result.budget, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("item1: arm A and arm C carry identical built-in tools for the code task; mcp is the only arm-specific addition", async () => {
  const stubDir = stubClaudeDir();
  const codeTask = resolve("tasks/bench-bug-fix");
  const rootA = join(tmpdir(), `bench-rq1-parityA-${process.pid}-${Date.now()}`);
  const rootC = join(tmpdir(), `bench-rq1-parityC-${process.pid}-${Date.now()}`);
  const hubEntry = stubHubDir(EXPECTED);
  const port = await freePort();
  try {
    const rA = invoke([codeTask, "A", "1", "--root", rootA], { PATH: `${stubDir}${delimiter}${process.env.PATH}` });
    assert.equal(rA.status, 0, rA.stderr + rA.stdout);
    const resultA = JSON.parse(readFileSync(join(rootA, "result.json"), "utf8"));
    const argvA: string[] = resultA.seats[0].argv;
    const toolsA = argvA[argvA.indexOf("--tools") + 1].split(",").sort();

    const rC = invoke([codeTask, "C", "1", "--root", rootC, "--port", String(port), "--seats", "1", "--hub-entry", hubEntry, "--timeout-ms", "10000"], {
      PATH: `${stubDir}${delimiter}${process.env.PATH}`,
    });
    assert.equal(rC.status, 0, rC.stderr + rC.stdout);
    const resultC = JSON.parse(readFileSync(join(rootC, "result.json"), "utf8"));
    const argvC: string[] = resultC.seats[0].argv;
    const toolsC = argvC[argvC.indexOf("--tools") + 1].split(",").sort();

    assert.deepEqual(toolsC, toolsA, "arm C's built-in tools must be identical to arm A's (chatroom mcp tools are --allowedTools only, not --tools)");
    assert.ok(toolsA.includes("Bash"), "the code task's built-in tools must include Bash on both arms");
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootC, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

/** A stub `claude` for arm B's builder+reviewer pipeline (protocol.md 2.1): behavior is keyed off
 * GIT_AUTHOR_NAME, which seatChildEnv already sets per seat name (src/env.ts's seatGitIdentity), so the
 * three sequential invocations (builder-1, reviewer, optional builder-2) can each answer differently
 * without any new plumbing in bench-rq1.ts itself. `review` controls what the reviewer stub says. */
function stubClaudeDirArmB(review: "approve" | "revise") {
  const dir = mkdtempSync(join(tmpdir(), "bench-rq1-armb-stub-"));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    [
      "#!/usr/bin/env node",
      "const fs=require('node:fs');",
      "const args=process.argv.slice(2);",
      "if(!args.includes('--output-format')||args[args.indexOf('--output-format')+1]!=='stream-json'||!args.includes('--verbose')){process.stderr.write('expected --output-format stream-json --verbose\\n');process.exit(1);}",
      "const who=process.env.GIT_AUTHOR_NAME||'';",
      `const review=${JSON.stringify(review)};`,
      "let text;",
      "if(who==='builder-1'){fs.writeFileSync('answer.txt', review==='revise'?'wrong affiliation':" + JSON.stringify(EXPECTED) + ");text='builder-1 submission';}",
      "else if(who==='reviewer'){text = review==='approve' ? 'APPROVE' : 'REVISE: the affiliation is wrong, fix answer.txt';}",
      `else if(who==='builder-2'){fs.writeFileSync('answer.txt', ${JSON.stringify(EXPECTED)});text='builder-2 revised submission';}`,
      "else{text='unexpected role: '+who;}",
      "process.stdout.write(JSON.stringify({type:'assistant',message:{usage:{input_tokens:80,output_tokens:15}}})+'\\n');",
      "process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:text,num_turns:2,duration_ms:500,duration_api_ms:520,total_cost_usd:0.002,usage:{input_tokens:100,output_tokens:20}})+'\\n');",
      "",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  return dir;
}

test("arm B: builder submits, reviewer approves, no revision round, no mcp tools either side, budget null", () => {
  const stubDir = stubClaudeDirArmB("approve");
  const root = join(tmpdir(), `bench-rq1-b-approve-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "B", "1", "--root", root], { PATH: `${stubDir}${delimiter}${process.env.PATH}` });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(result.arm, "B");
    assert.equal(result.outcome, "task_pass");
    assert.equal(result.passed, true);
    assert.equal(result.seats.length, 2, "builder-1 and reviewer only, no revision round on approve");
    assert.deepEqual(result.seats.map((s: any) => s.name), ["builder-1", "reviewer"]);
    assert.equal(result.budget, null, "arm B runs to natural completion like arm C, not budget-matched like arm A");
    for (const seat of result.seats) assert.ok(!seat.argv.some((a: string) => a.includes("mcp__chatroom")), "arm B must not carry chatroom mcp tools on either side");
    const reviewerArgv: string[] = result.seats[1].argv;
    const reviewerTools = reviewerArgv[reviewerArgv.indexOf("--tools") + 1].split(",");
    assert.ok(!reviewerTools.includes("Write"), "the reviewer must not be able to edit the submission itself");
    assert.ok(Math.abs(result.usage.cost_usd - 0.004) < 1e-9, "cost sums across both stages");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("arm B: reviewer requests one revision, builder revises once, then scores the revised answer (no second review)", () => {
  const stubDir = stubClaudeDirArmB("revise");
  const root = join(tmpdir(), `bench-rq1-b-revise-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "B", "2", "--root", root], { PATH: `${stubDir}${delimiter}${process.env.PATH}` });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(result.seats.length, 3, "builder-1, reviewer, builder-2 — at most one revision round");
    assert.deepEqual(result.seats.map((s: any) => s.name), ["builder-1", "reviewer", "builder-2"]);
    assert.equal(readFileSync(join(root, "workspace", "answer.txt"), "utf8"), EXPECTED, "the revised answer, not the original wrong one, is what's on disk");
    assert.equal(result.outcome, "task_pass");
    assert.equal(result.passed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

/** builder-1 sleeps before answering (simulating a slow real call); reviewer hangs forever (like the
 * existing "kill" stub) so it can only end via the deadline timer. Used to prove arm B's deadline is one
 * shared wall-clock budget for the whole pipeline (protocol.md 2: "the same wall-clock timeout per task"),
 * not a fresh grant re-issued to every stage. */
function stubClaudeDirArmBSlowThenHang(builderSleepMs: number) {
  const dir = mkdtempSync(join(tmpdir(), "bench-rq1-armb-slow-stub-"));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    [
      "#!/usr/bin/env node",
      "const fs=require('node:fs');",
      "const args=process.argv.slice(2);",
      "if(!args.includes('--output-format')||args[args.indexOf('--output-format')+1]!=='stream-json'||!args.includes('--verbose')){process.stderr.write('expected --output-format stream-json --verbose\\n');process.exit(1);}",
      "const who=process.env.GIT_AUTHOR_NAME||'';",
      "if(who==='builder-1'){",
      `  setTimeout(()=>{`,
      `    fs.writeFileSync('answer.txt', ${JSON.stringify(EXPECTED)});`,
      "    process.stdout.write(JSON.stringify({type:'assistant',message:{usage:{input_tokens:80,output_tokens:15}}})+'\\n');",
      "    process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'builder-1 submission',num_turns:2,duration_ms:500,duration_api_ms:520,total_cost_usd:0.002,usage:{input_tokens:100,output_tokens:20}})+'\\n');",
      `  }, ${builderSleepMs});`,
      "}else{",
      "  process.stdout.write(JSON.stringify({type:'assistant',message:{usage:{input_tokens:80,output_tokens:15}}})+'\\n');",
      "  setInterval(()=>{},1000);",
      "}",
      "",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  return dir;
}

test("arm B: the reviewer runs on a snapshot copy, so a reviewer that writes or deletes files cannot alter the scored workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-rq1-armb-tamper-stub-"));
  writeFileSync(
    join(dir, "claude"),
    [
      "#!/usr/bin/env node",
      "const fs=require('node:fs');",
      "const who=process.env.GIT_AUTHOR_NAME||'';",
      "let text='ok';",
      `if(who==='builder-1'){fs.writeFileSync('answer.txt',${JSON.stringify(EXPECTED)});text='builder-1 submission';}`,
      "else if(who==='reviewer'){fs.writeFileSync('answer.txt','TAMPERED BY REVIEWER');fs.writeFileSync('reviewer-marker.txt',process.cwd());text='APPROVE';}",
      "process.stdout.write(JSON.stringify({type:'assistant',message:{usage:{input_tokens:1,output_tokens:1}}})+'\\n');",
      "process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:text,num_turns:1,duration_ms:1,duration_api_ms:1,total_cost_usd:0.001,usage:{input_tokens:1,output_tokens:1}})+'\\n');",
      "",
    ].join("\n"),
  );
  chmodSync(join(dir, "claude"), 0o755);
  const root = join(tmpdir(), `bench-rq1-b-tamper-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "B", "4", "--root", root], { PATH: `${dir}${delimiter}${process.env.PATH}` });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(readFileSync(join(root, "workspace", "answer.txt"), "utf8"), EXPECTED, "reviewer writes must not reach the scored workspace");
    assert.equal(existsSync(join(root, "workspace", "reviewer-marker.txt")), false);
    assert.equal(result.outcome, "task_pass");
    assert.notEqual(readFileSync(join(root, "review-workspace", "reviewer-marker.txt"), "utf8"), join(root, "workspace"), "reviewer cwd is not the scored workspace");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("arm B: the deadline is one shared wall-clock budget for the whole pipeline, not a fresh grant per stage", () => {
  const stubDir = stubClaudeDirArmBSlowThenHang(1000);
  const root = join(tmpdir(), `bench-rq1-b-deadline-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "B", "3", "--root", root, "--deadline-ms", "1800"], { PATH: `${stubDir}${delimiter}${process.env.PATH}` });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.equal(result.outcome, "timeout");
    assert.deepEqual(result.seats.map((s: any) => s.name), ["builder-1", "reviewer"], "the reviewer runs out of shared budget; a third (revision) stage never starts");
    assert.equal(result.seats[1].killed_by_deadline, true);
    assert.ok(
      result.wall_clock.duration_ms < 2600,
      `reviewer must be killed on the budget REMAINING after builder-1's 1000ms sleep plus process startup, not a fresh 1800ms (which would put the total above ~2800ms); got ${result.wall_clock.duration_ms}ms`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("arm C: hidden fixtures never copied into the seat-visible workspace", async () => {
  const stubDir = stubClaudeDir();
  const hubEntry = stubHubDir(EXPECTED);
  const port = await freePort();
  const root = join(tmpdir(), `bench-rq1-hide-${process.pid}-${Date.now()}`);
  try {
    const r = invoke([task, "C", "1", "--root", root, "--port", String(port), "--seats", "1", "--hub-entry", hubEntry, "--timeout-ms", "10000"], {
      PATH: `${stubDir}${delimiter}${process.env.PATH}`,
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(existsSync(join(root, "workspace", "oracle")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});
