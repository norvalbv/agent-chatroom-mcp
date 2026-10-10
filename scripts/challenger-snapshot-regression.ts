/**
 * The fresh challenger checks a detached snapshot of the proposer's commit, not the proposer's live worktree
 * (swarm-000525-jcz8 remaining/recruiting item 2; sources/challenger-snapshot in swarm-082539-kns2). Since 827bf78b the
 * recruit's shell ran in the proposer's tree: Bash is in its tools, so a `git checkout <parent>` or a build moved or
 * rewrote the tree the proposer was still working in, and the claim it checked could change under it mid-check.
 * Now the hub plans a `git worktree add --detach` of the proposer's HEAD outside the repository, the brief names the
 * commit (verification binds to the commit: done-means-independently-verified) and how many uncommitted files the
 * proposer has that the snapshot does not hold, and the worktree is removed when the recruit exits. A tree that is
 * not a git checkout keeps the old behaviour. Run: npx tsx scripts/challenger-snapshot-regression.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as spawnerModule from "../src/spawner.js";
import { Spawner, type SpawnerHooks, type SpawnedAgent } from "../src/spawner.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const hooks: SpawnerHooks = { isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: () => {}, liveAgents: () => 0, roomTopic: () => "t" };

// a proposer's worktree: one commit, then an uncommitted edit and an untracked file on top
const repo = realpathSync(mkdtempSync(join(tmpdir(), "snapshot-proposer-")));
git(repo, "init", "-q");
writeFileSync(join(repo, "a.txt"), "committed\n");
git(repo, "add", "a.txt");
git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "one");
const sha = git(repo, "rev-parse", "HEAD");
writeFileSync(join(repo, "a.txt"), "edited, not committed\n");
writeFileSync(join(repo, "b.txt"), "untracked\n");

const spawner = new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: process.cwd(), logDir: mkdtempSync(join(tmpdir(), "snapshot-logs-")), dryRun: true, freshChallenger: true });
spawner.attach(hooks);
const rec = spawner.freshChallenger("room-snap", { id: "prop_s", text: "a.txt says committed.", by: "seat-1", cwd: repo }) as SpawnedAgent;
assert.ok(rec, "a fresh challenger was planned");

// 1. it does not work in the proposer's live tree, nor anywhere inside the repository
assert.notEqual(rec.cwd, repo, "the fresh challenger's cwd is not the proposer's live worktree");
assert.ok(!rec.cwd.startsWith(repo + "/"), "the snapshot lies outside the proposer's tree");
// 2. the brief names the commit it checks, and says what the snapshot leaves out
assert.ok(rec.brief.includes(sha.slice(0, 12)), "the brief names the commit the snapshot holds");
assert.match(rec.brief, /2 uncommitted/, "the brief says how many uncommitted files of the proposer are not in the snapshot");

// 3. the snapshot itself: a detached worktree at that commit, isolated from the proposer's tree, removable
const { createSnapshot, removeSnapshot, planSnapshot } = spawnerModule as unknown as {
  planSnapshot: (src: string, label: string) => { dir: string; sha: string; dirty: number; repo: string } | undefined;
  createSnapshot: (plan: { dir: string; sha: string; repo: string }) => boolean;
  removeSnapshot: (plan: { dir: string; repo: string }) => void;
};
assert.equal(typeof planSnapshot, "function", "spawner exports planSnapshot");
const plan = planSnapshot(repo, "room-snap-x")!;
assert.equal(plan.sha, sha);
assert.equal(plan.dirty, 2);
assert.ok(createSnapshot(plan), "the snapshot is created");
assert.equal(git(plan.dir, "rev-parse", "HEAD"), sha, "detached at the proposer's commit");
assert.equal(readFileSync(join(plan.dir, "a.txt"), "utf8"), "committed\n", "it holds the committed file, not the live edit");
// what the checker does there never reaches the proposer's tree
writeFileSync(join(plan.dir, "a.txt"), "the checker scribbled\n");
git(plan.dir, "checkout", "-q", "--", "a.txt");
assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "edited, not committed\n", "the proposer's uncommitted edit is untouched");
assert.equal(git(repo, "rev-parse", "--abbrev-ref", "HEAD").length > 0, true);
removeSnapshot(plan);
assert.ok(!existsSync(plan.dir), "the snapshot directory is removed");
assert.ok(!git(repo, "worktree", "list").includes(plan.dir), "and git no longer lists it");

// 4. a tree that is not a git checkout keeps the old behaviour: the recruit runs there
const plain = mkdtempSync(join(tmpdir(), "snapshot-plain-"));
assert.equal(planSnapshot(plain, "x"), undefined, "no snapshot outside a git checkout");
const s2 = new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: process.cwd(), logDir: mkdtempSync(join(tmpdir(), "snapshot-logs-")), dryRun: true, freshChallenger: true });
s2.attach(hooks);
assert.equal(s2.freshChallenger("room-plain", { id: "prop_p", text: "x", by: "seat-1", cwd: plain })!.cwd, plain);

rmSync(repo, { recursive: true, force: true });
console.log("challenger-snapshot-regression OK");
