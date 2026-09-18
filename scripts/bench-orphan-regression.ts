/** Item 5 (orphans): node --import tsx scripts/bench-orphan-regression.ts
 * Proves that stopping scripts/bench-rq1.ts or scripts/bench-grid.ts by SIGTERM does not leave the hub,
 * the claude seats, or (for the grid) the bench-rq1.ts invocation itself running, reparented to pid 1.
 * Never calls the real claude CLI or hub: long-lived stub executables stand in (pattern:
 * scripts/bench-rq1.test.ts's stubClaudeDir/stubHubDir), each recording its own pid so the test can
 * assert it is dead after the parent is stopped.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createServer } from "node:net";

const task = resolve("tasks/bench-fact-check");

async function freePort(): Promise<number> {
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

/** A stub `claude` on PATH that never exits on its own (a real seat still running at the deadline). */
function stubHangingClaudeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bench-orphan-claude-"));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    [
      "#!/usr/bin/env node",
      "const fs=require('node:fs');",
      "const file=process.env.STUB_CLAUDE_PID_FILE;",
      "if(file)fs.appendFileSync(file,process.pid+'\\n');",
      "setInterval(()=>{},1000);",
      "",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  return dir;
}

/** A stub hub entry that answers readiness/room-create but otherwise just stays up (never concludes). */
function stubHangingHubDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bench-orphan-hub-"));
  const entry = join(dir, "hub.mjs");
  writeFileSync(
    entry,
    `import http from 'node:http';import fs from 'node:fs';
const pidFile=process.env.STUB_HUB_PID_FILE;
if(pidFile)fs.appendFileSync(pidFile,process.pid+'\\n');
const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');
 if(req.method==='POST'&&req.url==='/rooms/rq1/create'){res.end('{}');return;}
 if(req.url==='/rooms'){res.end(JSON.stringify({rooms:[],version:'stub-hub-v1'}));return;}
 res.end('{}');});
server.listen(Number(process.env.PORT),'127.0.0.1');`,
  );
  return entry;
}

/** A stub bench-rq1.ts stand-in for the grid-level test: never exits on its own either. */
function stubHangingRunner(dir: string): string {
  const stub = join(dir, "stub-hanging-runner.mjs");
  writeFileSync(
    stub,
    [
      "import { appendFileSync } from 'node:fs';",
      "const file = process.env.STUB_RUNNER_PID_FILE;",
      "if (file) appendFileSync(file, process.pid + '\\n');",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"),
  );
  return stub;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code !== "ESRCH";
  }
}

async function waitFor(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

function pidsFromFile(file: string): number[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(Number);
}

test("bench-rq1.ts arm C: SIGTERM to the runner kills the hub and every claude seat (no orphans)", async () => {
  const claudeDir = stubHangingClaudeDir();
  const hubEntry = stubHangingHubDir();
  const workDir = mkdtempSync(join(tmpdir(), "bench-orphan-rq1-"));
  const claudePidFile = join(workDir, "claude-pids.txt");
  const hubPidFile = join(workDir, "hub-pids.txt");
  const root = join(workDir, "root");
  const port = await freePort();
  const seats = 2;
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawn(
      process.execPath,
      ["--import", "tsx", resolve("scripts/bench-rq1.ts"), task, "C", "1", "--root", root, "--port", String(port), "--seats", String(seats), "--hub-entry", hubEntry, "--timeout-ms", "60000"],
      {
        env: { ...process.env, PATH: `${claudeDir}${delimiter}${process.env.PATH}`, STUB_CLAUDE_PID_FILE: claudePidFile, STUB_HUB_PID_FILE: hubPidFile },
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    assert.ok(child.pid, "runner must have a pid");

    await waitFor(() => pidsFromFile(hubPidFile).length >= 1 && pidsFromFile(claudePidFile).length >= seats, 15000, "hub and all claude seats to start");
    const hubPid = pidsFromFile(hubPidFile)[0];
    const claudePids = pidsFromFile(claudePidFile);
    assert.ok(isAlive(hubPid), "hub must be alive before the kill (sanity)");
    for (const p of claudePids) assert.ok(isAlive(p), `claude seat ${p} must be alive before the kill (sanity)`);

    child.kill("SIGTERM");
    await new Promise<void>((ok) => child!.once("exit", () => ok()));
    child = undefined;

    await new Promise((r) => setTimeout(r, 300)); // grace period for the SIGKILL cascade to land
    assert.equal(isAlive(hubPid), false, "hub must not survive the runner's SIGTERM (orphan)");
    for (const p of claudePids) assert.equal(isAlive(p), false, `claude seat ${p} must not survive the runner's SIGTERM (orphan)`);
  } finally {
    if (child && child.pid) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    for (const p of [...pidsFromFile(hubPidFile), ...pidsFromFile(claudePidFile)]) {
      try {
        if (isAlive(p)) process.kill(p, "SIGKILL");
      } catch {}
    }
    rmSync(claudeDir, { recursive: true, force: true });
    rmSync(hubEntry, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("bench-grid.ts: SIGTERM to the grid kills its in-flight scripts/bench-rq1.ts invocation (no orphans)", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "bench-orphan-grid-"));
  const runnerPidFile = join(workDir, "runner-pids.txt");
  const resultsDir = join(workDir, "results");
  const stubRunner = stubHangingRunner(workDir);
  mkdirSync(resultsDir, { recursive: true });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("scripts/bench-grid.ts"),
        "--tasks",
        "bench-fact-check",
        "--seeds",
        "1",
        "--arms",
        "C",
        "--tasks-dir",
        resolve("tasks"),
        "--include-retired",
        "--results-dir",
        resultsDir,
        "--runner",
        stubRunner,
      ],
      { env: { ...process.env, STUB_RUNNER_PID_FILE: runnerPidFile }, stdio: ["ignore", "ignore", "ignore"] },
    );
    assert.ok(child.pid, "grid must have a pid");

    await waitFor(() => pidsFromFile(runnerPidFile).length >= 1, 15000, "the stub runner to start");
    const runnerPid = pidsFromFile(runnerPidFile)[0];
    assert.ok(isAlive(runnerPid), "the stub runner must be alive before the kill (sanity)");

    child.kill("SIGTERM");
    await new Promise<void>((ok) => child!.once("exit", () => ok()));
    child = undefined;

    await new Promise((r) => setTimeout(r, 300));
    assert.equal(isAlive(runnerPid), false, "the in-flight runner must not survive the grid's SIGTERM (orphan)");
  } finally {
    if (child && child.pid) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    for (const p of pidsFromFile(runnerPidFile)) {
      try {
        if (isAlive(p)) process.kill(p, "SIGKILL");
      } catch {}
    }
    rmSync(workDir, { recursive: true, force: true });
  }
});

console.log("BENCH ORPHAN REGRESSION OK");
