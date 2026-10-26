/**
 * A recruit starts where its recruiter is (evidence-pack item 13, chat-and-friction 12; claim/recruit-base).
 * swarm-123021-1nwp-audit #33: "Recruit worktrees are cut from main-checkout HEAD 7c43aef4 (#781, Oct 3), and
 * BENCH_CORRECTNESS_MODEL does not exist at that commit. The machine-rules command therefore runs gpt-5.6-sol". The room
 * was launched from devkit-correctness-swarm, a git worktree of devkit at eadfcdc2, while the main devkit checkout sat
 * at 7c43aef4: request_agent with no cwd took the recruiter's PROJECT (the main checkout) and `git worktree add` with
 * no start point, so a write recruit's branch began at the main checkout's HEAD, and a read-only recruit read the main
 * checkout's stale files. Now a write recruit's branch is cut from the HEAD of its recruiter's worktree, and the spawn
 * record says which commit and whose. Red on main: recruitBase does not exist and the branch starts at the stale commit.
 * Run: npx tsx scripts/recruit-base-regression.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as spawnerModule from "../src/spawner.js";
import { Spawner, createSnapshot, planSnapshot, removeSnapshot } from "../src/spawner.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A main checkout at an old commit and a worktree of it two commits ahead: the shape of devkit and devkit-correctness-swarm. */
function repo() {
  const main = realpathSync(mkdtempSync(join(tmpdir(), "recruit-base-main-")));
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "t@t"); git(main, "config", "user.name", "t");
  writeFileSync(join(main, "bench.txt"), "model gpt-old\n");
  git(main, "add", "-A"); git(main, "commit", "-q", "-m", "old main");
  const stale = git(main, "rev-parse", "HEAD");
  const launch = join(main, "..", `recruit-base-launch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  git(main, "worktree", "add", "-q", "-b", "launch", launch);
  writeFileSync(join(launch, "bench.txt"), "model claude-haiku-5-5\n");
  git(launch, "commit", "-q", "-am", "haiku support");
  // the recruiter's own seat worktree, cut from the launch checkout, with one more commit of its own
  const seat = join(main, ".swarm-worktrees", "room-a", "seat-1");
  git(launch, "worktree", "add", "-q", "-b", "swarm/room-a/seat-1", seat);
  writeFileSync(join(seat, "result.txt"), "seat-1's result\n");
  git(seat, "add", "-A"); git(seat, "commit", "-q", "-m", "seat work");
  return { main, launch: realpathSync(launch), seat: realpathSync(seat), stale, seatHead: git(seat, "rev-parse", "HEAD") };
}

type Mod = typeof spawnerModule & {
  recruitBase?: (root: string, from?: string) => { sha: string; from: string } | undefined;
  createRecruitWorktree?: (root: string, dir: string, branch: string, base?: string) => Promise<{ ok: boolean; error?: string }>;
};
const mod = spawnerModule as Mod;

test("recruitBase: the recruiter's worktree HEAD, only when it is a checkout of the same repository", () => {
  const r = repo();
  assert.equal(typeof mod.recruitBase, "function", "recruitBase is exported");
  assert.deepEqual(mod.recruitBase!(r.main, r.seat), { sha: r.seatHead, from: r.seat });
  assert.equal(mod.recruitBase!(r.main, undefined), undefined, "no recruiter worktree: the project's HEAD, as before");
  const other = repo();
  assert.equal(mod.recruitBase!(r.main, other.seat), undefined, "a worktree of another repository is never a base");
  assert.equal(mod.recruitBase!(r.main, tmpdir()), undefined, "nor is a directory outside git");
});

test("a write recruit's worktree is cut from that commit, not from the main checkout's HEAD", async () => {
  const r = repo();
  assert.equal(typeof mod.createRecruitWorktree, "function", "createRecruitWorktree is exported");
  const dir = join(r.main, ".swarm-worktrees", "room-a", "builder");
  assert.ok((await mod.createRecruitWorktree!(r.main, dir, "swarm/room-a/builder", r.seatHead)).ok);
  assert.equal(git(dir, "rev-parse", "HEAD"), r.seatHead, "the recruit starts at its recruiter's HEAD");
  assert.equal(git(dir, "show", "HEAD:bench.txt"), "model claude-haiku-5-5", "so it runs the benchmark the room is on");
  assert.ok(existsSync(join(dir, "result.txt")), "and has the recruiter's own commits");
  assert.equal(git(dir, "branch", "--show-current"), "swarm/room-a/builder");
  // without a base it is the old behaviour: the main checkout's HEAD
  const dir2 = join(r.main, ".swarm-worktrees", "room-a", "plain");
  assert.ok((await mod.createRecruitWorktree!(r.main, dir2, "swarm/room-a/plain")).ok);
  assert.equal(git(dir2, "rev-parse", "HEAD"), r.stale);
});

test("the spawn record says which commit a write recruit starts from, and whose", () => {
  const r = repo();
  const spawner = new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: r.main, logDir: mkdtempSync(join(tmpdir(), "recruit-base-log-")), dryRun: true });
  spawner.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: () => {}, liveAgents: () => 0 });
  const [w] = spawner.request({ room: "room-a", requestedBy: "seat-1", brief: "Build the parser and commit it on your branch.", name: "builder", canEdit: true, cwd: r.main, baseDir: r.seat } as never);
  assert.deepEqual((w.workspace as { base?: unknown }).base, { sha: r.seatHead, from: r.seat });
  assert.ok(w.workspace!.worktree.startsWith(join(r.main, ".swarm-worktrees")), "the worktree still lives under the project");
  const [plain] = spawner.request({ room: "room-a", requestedBy: "seat-1", brief: "Build the lexer and commit it on your branch.", name: "builder-2", canEdit: true, cwd: r.main });
  assert.equal((plain.workspace as { base?: unknown }).base, undefined, "no recruiter worktree known: nothing claimed about the base");
});

test("a read-only recruit reads a detached snapshot of its recruiter's HEAD: not the stale checkout, not the half-typed edits", () => {
  // attack/decision/recruit-base (claude-opus-5-5-4): sharing the recruiter's live tree would share its builds and its uncommitted edits
  const r = repo();
  writeFileSync(join(r.seat, "result.txt"), "HALF-TYPED, not committed\n");
  const plan = planSnapshot(r.seat, "room-a-reader")!;
  assert.equal(plan.sha, r.seatHead, "the snapshot is of the recruiter's HEAD");
  assert.equal(plan.dirty, 1, "and it knows one change there is not committed");
  assert.ok(!plan.dir.startsWith(r.main), "it lives outside the repository");
  assert.ok(createSnapshot(plan));
  try {
    assert.equal(readFileSync(join(plan.dir, "result.txt"), "utf8"), "seat-1's result\n", "the recruit reads the committed file, not the recruiter's uncommitted edit");
    assert.equal(readFileSync(join(plan.dir, "bench.txt"), "utf8"), "model claude-haiku-5-5\n", "and not the main checkout's stale one");
  } finally { removeSnapshot(plan); }
  // two read-only recruits of one request share that snapshot; each brief names the commit and the uncommitted count
  const logDir = mkdtempSync(join(tmpdir(), "recruit-base-log-"));
  const spawner = new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: r.main, logDir, dryRun: true });
  spawner.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: () => {}, liveAgents: () => 0 });
  const recs = spawner.request({ room: "room-a", requestedBy: "seat-1", brief: "Rerun the check on the parser and report what you find.", name: "reader", count: 2, cwd: r.seat, snapshot: planSnapshot(r.seat, "room-a-reader") });
  assert.equal(recs.length, 2);
  for (const x of recs) assert.ok(x.cwd.includes("chatroom-snapshot-room-a-reader"), `${x.name} runs in the snapshot, not in ${r.seat}`);
  assert.equal(recs[0].cwd, recs[1].cwd, "one snapshot for the request");
  const brief = readFileSync(recs[0].log, "utf8");
  assert.match(brief, new RegExp(`detached copy of the tree at commit ${r.seatHead.slice(0, 8)} \\(1 uncommitted change`), "the recruit is told which commit it reads and that one change is not in it");
});
