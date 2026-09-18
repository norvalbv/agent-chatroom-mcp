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

/** A stub `claude` on PATH: echoes back --output-format json with a canned result/usage/num_turns/duration_ms,
 * optionally writing STUB_ANSWER_FILE (answer.txt) into --mcp-config's sibling cwd via env-provided cwd hint. */
function stubClaudeDir(behavior: "answer" | "no-answer" | "edit-file" = "answer") {
  const dir = mkdtempSync(join(tmpdir(), "bench-rq1-stub-"));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    [
      "#!/usr/bin/env node",
      "const fs=require('node:fs');",
      "const args=process.argv.slice(2);",
      "if(!args.includes('--output-format')||args[args.indexOf('--output-format')+1]!=='json'){process.stderr.write('expected --output-format json\\n');process.exit(1);}",
      `const behavior=process.env.STUB_BEHAVIOR||'answer';`,
      `if(behavior==='answer')fs.writeFileSync('answer.txt',process.env.STUB_ANSWER||${JSON.stringify(EXPECTED)});`,
      "process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'seat done',num_turns:3,duration_ms:842,duration_api_ms:910,total_cost_usd:0.0041,usage:{input_tokens:120,cache_read_input_tokens:40,cache_creation_input_tokens:12,output_tokens:30}}));",
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
    const argv: string[] = result.seats[0].argv;
    assert.ok(argv.includes("--output-format"));
    assert.ok(!argv.some((a) => a.includes("mcp__chatroom")), "arm A must not carry chatroom mcp tools");
    const mcpConfig = JSON.parse(readFileSync(join(root, "mcp-empty.json"), "utf8"));
    assert.deepEqual(mcpConfig, { mcpServers: {} });
    assert.ok(Number.isFinite(Date.parse(result.wall_clock.started_at)));
    assert.ok(result.wall_clock.duration_ms >= 0);
    assert.equal(result.budget.deadline_ms, 300000);
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
