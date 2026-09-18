#!/usr/bin/env node
/**
 * RQ1 harness item 3 wiring (swarm-120129-s12h, claim/usage-budget): the arm-pairing orchestrator.
 * RED before this change: scripts/rq1-run-pair.ts does not exist, so arm A's budget was never actually
 * derived from a real arm C run -- matchArmABudget existed as a tested pure function but nothing called
 * it with a real arm C result.
 * GREEN after: runPair() shells out to scripts/bench-rq1.ts (sonnet-3's item 1) for arm C first, reads
 * its result.json, calls matchArmABudget(), then shells out for arm A with --max-budget-usd/--deadline-ms
 * set accordingly and the same seed. No real model is ever invoked: a stub `claude` executable (pattern:
 * scripts/claude-usage-regression.ts, scripts/bench-rq1.test.ts) and a stub hub stand in for both.
 *
 *   npx tsx scripts/rq1-run-pair-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { delimiter, join, resolve } from "node:path";

const { runPair } = await import("./rq1-run-pair.js");

const task = resolve("tasks/bench-fact-check");
const EXPECTED = "Society for Formal Methods, Vienna";

/** Stub `claude`: canned JSON envelope with a fixed cost/turns/duration, distinguishable per invocation
 * count via STUB_COST_USD so arm C and arm A can report different realized spend if a test wants that;
 * writes answer.txt so bench-rq1.ts's unmodified scorer can score task_pass. */
function stubClaudeDir() {
  const dir = mkdtempSync(join(tmpdir(), "rq1-run-pair-stub-"));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    [
      "#!/usr/bin/env node",
      "const fs=require('node:fs');",
      "const args=process.argv.slice(2);",
      "if(!args.includes('--output-format')||args[args.indexOf('--output-format')+1]!=='json'){process.stderr.write('expected --output-format json\\n');process.exit(1);}",
      `fs.writeFileSync('answer.txt',process.env.STUB_ANSWER||${JSON.stringify(EXPECTED)});`,
      "const cost=Number(process.env.STUB_COST_USD||'0.01');",
      "const budgetFlagIdx=args.indexOf('--max-budget-usd');",
      "if(budgetFlagIdx>=0)fs.writeFileSync('seen-max-budget-usd.txt',args[budgetFlagIdx+1]);",
      "process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'seat done',num_turns:2,duration_ms:500,duration_api_ms:450,total_cost_usd:cost,usage:{input_tokens:50,cache_read_input_tokens:10,cache_creation_input_tokens:5,output_tokens:15}}));",
      "",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  return dir;
}

function stubHubDir(text = EXPECTED) {
  const dir = mkdtempSync(join(tmpdir(), "rq1-run-pair-hub-"));
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

async function freePort() {
  const base = 21000 + ((process.pid * 2654435761) % 20000);
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

// (a) exists / basic shape
assert.ok(existsSync(resolve("scripts/rq1-run-pair.ts")), "scripts/rq1-run-pair.ts must exist");

const stubDir = stubClaudeDir();
const hubEntry = stubHubDir();
const rootBase = mkdtempSync(join(tmpdir(), "rq1-run-pair-root-"));
try {
  const port = await freePort();
  const env = { ...process.env, PATH: `${stubDir}${delimiter}${process.env.PATH}`, STUB_COST_USD: "0.05" };

  const outcome = runPair({ taskDir: task, seed: 7, rootBase, model: "sonnet", port, seats: 2, timeoutMs: 30000, hubEntry, env });

  // (b) both arm roots exist at the pinned path convention and both share the seed.
  assert.equal(outcome.taskId, "bench-fact-check");
  assert.ok(outcome.armCRoot.endsWith(`bench-fact-check-C-seed7`), `(b) arm C root path convention: ${outcome.armCRoot}`);
  assert.ok(outcome.armARoot.endsWith(`bench-fact-check-A-seed7`), `(b) arm A root path convention: ${outcome.armARoot}`);
  const cResult = JSON.parse(readFileSync(join(outcome.armCRoot, "result.json"), "utf8"));
  const aResult = JSON.parse(readFileSync(join(outcome.armARoot, "result.json"), "utf8"));
  assert.equal(cResult.arm, "C");
  assert.equal(aResult.arm, "A");
  assert.equal(cResult.seed, 7, "(b) paired seed: arm C");
  assert.equal(aResult.seed, 7, "(b) paired seed: arm A");

  // (c) arm A's --max-budget-usd equals arm C's realized total cost_usd (2 seats * 0.05), and the
  // deadline_ms equals arm C's realized wall-clock duration -- the paired, within-task budget match.
  assert.ok(Math.abs(cResult.usage.cost_usd - 0.1) < 1e-9, `(c) sanity: arm C realized cost is 2*0.05: ${cResult.usage.cost_usd}`);
  assert.equal(outcome.budget.maxBudgetUsd, cResult.usage.cost_usd, "(c) matched budget equals arm C's realized cost_usd");
  assert.equal(outcome.budget.wallClockCapMs, cResult.wall_clock.duration_ms, "(c) matched wall-clock cap equals arm C's realized duration");
  assert.equal(aResult.budget.max_budget_usd, cResult.usage.cost_usd, "(c) arm A's recorded budget.max_budget_usd matches");
  assert.equal(aResult.budget.deadline_ms, cResult.wall_clock.duration_ms, "(c) arm A's recorded budget.deadline_ms matches");
  const seenBudget = readFileSync(join(outcome.armARoot, "workspace", "seen-max-budget-usd.txt"), "utf8");
  assert.equal(Number(seenBudget), cResult.usage.cost_usd, "(c) --max-budget-usd was actually forwarded into the claude CLI argv");

  console.log("rq1-run-pair-regression: OK");
} finally {
  rmSync(rootBase, { recursive: true, force: true });
  rmSync(stubDir, { recursive: true, force: true });
  rmSync(hubEntry, { force: true });
}
