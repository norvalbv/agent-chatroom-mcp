/** The stray sweep (src/strays.ts) and its use in src/swarm.ts: node --import tsx scripts/strays.test.ts (needs npm run build)
 * swarm.ts's timeout and SIGTERM paths used to c.kill() direct children only, so a process a seat detached (a dev hub)
 * outlived `node dist/swarm.js` (docs/reuse-survey-2026-09-23.md, "Process containment and the stray sweep").
 * Every process here is started by this test, carries a random marker in its argv and is stopped by pid. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pidsUnder, stopStrays } from "../src/strays.ts";
import * as poolRun from "./pool-run.ts";
import { startHub } from "./seat-launch-fixture.ts";

const MARKER = `stray-marker-${randomBytes(4).toString("hex")}`;
const base = realpathSync(mkdtempSync(join(tmpdir(), "strays-")));
const started = new Set<number>();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const idle = (cwd: string, tag: string) => {
  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", `${MARKER}-${tag}`], { cwd, detached: true, stdio: "ignore" });
  c.unref(); started.add(c.pid!); return c.pid!;
};
const waitFor = async (ok: () => unknown, what: string, ms = 20_000) => { for (const until = Date.now() + ms; !ok(); ) { if (Date.now() > until) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 50)); } };

// ---- swarm.ts: a seat in its worktree detaches a child (as a seat's dev hub would be) and then never finishes ----
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs'), cp = require('node:child_process'), path = require('node:path');
fs.readFileSync(0, 'utf8');
const role = process.cwd().includes(path.sep + '.swarm-worktrees' + path.sep) ? 'worker' : 'verifier';
const c = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', process.env.STRAY_MARKER + '-' + role], { cwd: process.cwd(), detached: true, stdio: 'ignore' });
c.unref();
fs.writeFileSync(path.join(process.env.STRAY_RECORD_DIR, role + '.pid'), String(c.pid));
setInterval(() => {}, 1000);
`;
const bin = join(base, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
chmodSync(join(bin, "claude"), 0o755);
const { hub, port } = await startHub(join(base, "hub-logs"), base);
// All async setup (the hub) finishes before the first test() is registered: node:test runs a top-level after() hook
// as soon as the tests queued so far have finished, so a test registered after a top-level await could find this torn down.
after(() => {
  hub.kill();
  for (const pid of started) if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
  rmSync(base, { recursive: true, force: true });
});

test("stopStrays stops what runs under the dir and nothing else: not a process outside it, not a spared one", async () => {
  const dir = join(base, "unit", "run"), outside = join(base, "unit", "elsewhere");
  mkdirSync(join(dir, "seat"), { recursive: true }); mkdirSync(outside, { recursive: true });
  const inner = idle(join(dir, "seat"), "inner"), spared = idle(dir, "spared"), other = idle(outside, "outside");
  await waitFor(() => pidsUnder(dir).includes(inner) && pidsUnder(dir).includes(spared), "lsof to see both processes under the dir");
  assert.ok(!pidsUnder(dir).includes(other));
  assert.equal(await stopStrays(dir, [spared]), 1);
  await waitFor(() => !alive(inner), "the stray to stop");
  assert.ok(alive(spared) && alive(other), "only the process under the dir, and not spared, is stopped");
});

test("pool-run sweeps with the same functions, moved rather than copied", () => {
  assert.equal(poolRun.stopStrays, stopStrays);
  assert.equal(poolRun.pidsUnder, pidsUnder);
});

/** A --full-access flat run in a fresh git repo: one worker in .swarm-worktrees/<run>/, the verifier in the repo itself. */
async function run(label: string, timeoutMin: string, stop?: (swarm: ChildProcess, records: string) => Promise<void>) {
  const repo = join(base, label), records = join(base, `${label}-records`);
  mkdirSync(repo); mkdirSync(records);
  const git = (...a: string[]) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q"); writeFileSync(join(repo, "README.md"), "fixture\n"); git("add", "."); git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  const swarm = spawn(process.execPath, [resolve("dist", "swarm.js"), "Fixture task for the stray sweep.", "--flat", "--agents", "2", "--full-access", "--models", "claude-opus-5-5",
    "--verifier-model", "claude-opus-5-5", "--port", String(port), "--timeout", timeoutMin, "--cwd", repo],
    { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STRAY_MARKER: MARKER, STRAY_RECORD_DIR: records }, stdio: ["ignore", "pipe", "pipe"] });
  started.add(swarm.pid!);
  let out = "";
  swarm.stdout!.on("data", (d) => (out += d));
  swarm.stderr!.on("data", (d) => (out += d));
  const closed = new Promise((ok) => swarm.on("close", ok));
  await waitFor(() => existsSync(join(records, "worker.pid")) && existsSync(join(records, "verifier.pid")), "both seats to detach their child");
  const worker = Number(readFileSync(join(records, "worker.pid"), "utf8")), verifier = Number(readFileSync(join(records, "verifier.pid"), "utf8"));
  started.add(worker); started.add(verifier);
  if (stop) await stop(swarm, records);
  await closed;
  const id = /swarm (swarm-[0-9]+-[a-z0-9]+):/.exec(out)?.[1];
  if (id) rmSync(resolve("swarms", id), { recursive: true, force: true });
  return { out, worker, verifier };
}

test("swarm.ts timeout: a child a seat detached inside its worktree is stopped; one in the project checkout is left alone", async () => {
  const { out, worker, verifier } = await run("timeout", "0.1");
  assert.match(out, /timeout after 0\.1 min/);
  assert.ok(!alive(worker), `the worker's detached child outlived the run:\n${out.slice(-1200)}`);
  assert.match(out, /timeout: stopped [1-9]\d* process\(es\) still running in this run's worktrees/);
  assert.ok(alive(verifier), "the sweep never reaches outside .swarm-worktrees/<run>/");
});

test("swarm.ts SIGTERM: stopping the launcher stops a child a seat detached inside its worktree", async () => {
  const { out, worker } = await run("sigterm", "5", async (swarm) => { swarm.kill("SIGTERM"); });
  assert.match(out, /SIGTERM: stopping/);
  assert.ok(!alive(worker), `the worker's detached child outlived the launcher:\n${out.slice(-1200)}`);
});
