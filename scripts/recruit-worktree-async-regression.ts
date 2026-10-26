/**
 * A write recruit's worktree is made off the hub's event loop (decision/machine-load). Spawner.request ran
 * `git worktree add` with spawnSync for each write recruit, one after another, inside the hub: on research-swarm
 * (swarm-164210-9f66) every breakout of 3 recruits held the hub, and every room on it, 1.8-3.8 s, and here a batch of
 * 3 of this repository's worktrees held a process 5.7-12.4 s (evidence/machine-load). The Node.js guide: "In a server,
 * you should not use ... child_process.spawnSync" (sources/nodejs-dont-block-the-event-loop).
 * Now request() plans the workspace (the reply still names it), returns, and the worktrees are made by an async child,
 * one at a time; each seat starts once its worktree exists, and each worktree is recorded with how long it took.
 * Run: npx tsx scripts/recruit-worktree-async-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Spawner } from "../src/spawner.js";

const work = mkdtempSync(join(tmpdir(), "recruit-wt-async-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
const repo = join(work, "repo");
const git = (...a: string[]) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
mkdirSync(repo);
git("init", "-q");
for (let d = 0; d < 10; d++) {
  mkdirSync(join(repo, `d${d}`));
  for (let f = 0; f < 200; f++) writeFileSync(join(repo, `d${d}`, `f${f}.txt`), `${d}/${f}\n`.repeat(100));
}
git("add", "-A");
spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "-m", "tree"]);
// the seat command is a stub that records where it was started, so no model runs
const bin = join(work, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "claude"), `#!/bin/sh\ncat >/dev/null\npwd > "$PWD/.started"\n`);
chmodSync(join(bin, "claude"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

const BRIEF = "a stub recruit for this test; it does nothing at all";
const said: string[] = [];
const recorded: { room: string; seat: string; ms: number; ok: boolean }[] = [];
const spawner = new Spawner({ mcpUrl: "http://127.0.0.1:1/mcp", defaultCwd: repo, logDir: join(work, "logs") });
spawner.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: (_r, t) => said.push(t), liveAgents: () => 0, recordWorktree: (room, e) => recorded.push({ room, ...e }) } as Parameters<Spawner["attach"]>[0]);

try {
  // 1. request() returns before any worktree is made: the hub's loop is free while git checks them out
  let worst = 0;
  let due = Date.now() + 20;
  const lag = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - due); due = now + 20; }, 20);
  const recs = spawner.request({ room: "room-a", requestedBy: "seat-1", brief: BRIEF, count: 3, canEdit: true, cwd: repo });
  const dirs = recs.map((r) => r.workspace?.worktree);
  assert.equal(recs.length, 3);
  assert.deepEqual(recs.map((r) => r.workspace?.branch), recs.map((r) => `swarm/room-a/${r.name}`), "the reply still names each recruit's branch");
  assert.ok(dirs.every((d) => d && !existsSync(d)), "request() returned before the worktrees were made: `git worktree add` no longer runs in the hub's event loop");
  assert.ok(recs.every((r) => r.pid === undefined), "and before any seat started");

  // 2. then each is made, one at a time, and its seat starts inside it
  for (let i = 0; i < 300 && !dirs.every((d) => existsSync(join(d!, ".started"))); i++) await new Promise((r) => setTimeout(r, 100));
  clearInterval(lag);
  for (const [i, d] of dirs.entries()) {
    assert.ok(existsSync(join(d!, "d9", "f199.txt")), `${recs[i]!.name}: its worktree is checked out`);
    assert.ok(existsSync(join(d!, ".started")), `${recs[i]!.name}: its seat started in its worktree`);
    assert.ok(recs[i]!.pid, `${recs[i]!.name}: and has a pid`);
  }
  assert.ok(worst < 1000, `the hub's loop stayed free while they were made (worst lag ${worst} ms)`);
  // telemetry: one record per worktree, with how long it took
  assert.deepEqual(recorded.map((e) => [e.room, e.seat, e.ok]), recs.map((r) => ["room-a", r.name, true]), "one worktree record per write recruit, in order");
  assert.ok(recorded.every((e) => e.ms >= 0));

  // 3. a worktree git refuses (its branch already exists): the seat still starts, in the requester's tree, and the room is told
  git("branch", "swarm/room-b/taken");
  const [t] = spawner.request({ room: "room-b", requestedBy: "seat-1", brief: BRIEF, name: "taken", canEdit: true, cwd: repo });
  for (let i = 0; i < 100 && !t!.pid; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(t!.pid, "the seat starts anyway");
  assert.equal(t!.workspace, undefined, "and is not said to have a worktree it does not have");
  assert.ok(said.some((s) => /taken/.test(s) && /could not make/.test(s) && /works in/.test(s)), "the room is told where it works instead");
  assert.equal(recorded.at(-1)?.ok, false, "and the failure is recorded");
} finally {
  spawner.stopAll();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(work, { recursive: true, force: true });
}
console.log("recruit-worktree-async-regression OK");
process.exit(0);
