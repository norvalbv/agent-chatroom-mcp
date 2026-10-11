/**
 * Which commits on an integration branch did someone other than their author review? (evidence-pack item 4, telemetry
 * gap G14). Across runs 5 of 21 verify entries named a merged commit: the integrator cherry-picks, so the merged SHA is
 * not the reviewed one, and "reviewed" was a key-name heuristic. scripts/review-coverage.ts joins the branch's commits to
 * the room's verify/* and review/* heads through the SHA, a cherry-pick trailer, the patch-id, or (a conflict-resolved
 * pick) the subject, and says which are unreviewed, self-reviewed or reviewed only by a failing head.
 * Run: npx tsx --test scripts/review-coverage-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { boardFromLog, reviewCoverage } from "./review-coverage.js";

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dir, "-c", "user.email=x@swarm.local", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: process.env.AUTHOR ?? "author", GIT_COMMITTER_NAME: "integrator" } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function commitAs(dir: string, author: string, file: string, text: string, msg: string): string {
  writeFileSync(join(dir, file), text);
  git(dir, "add", file);
  const r = spawnSync("git", ["-C", dir, "-c", "user.email=x@swarm.local", "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: author, GIT_COMMITTER_NAME: author } });
  assert.equal(r.status, 0, r.stderr);
  return git(dir, "rev-parse", "HEAD");
}
const pick = (dir: string, sha: string, ...flags: string[]) => {
  const r = spawnSync("git", ["-C", dir, "-c", "user.email=x@swarm.local", "-c", "user.name=integrator", "-c", "commit.gpgsign=false", "cherry-pick", ...flags, sha], { encoding: "utf8" });
  return r.status;
};
const head = (commit: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ proposal: "pending", command: "npx tsx scripts/x.ts", cwd: "/w", base_commit: "0123abcd", base_exit_code: 1, commit, exit_code: 0, output_tail: "ok", ...over });

test("each integration commit is matched to its review through SHA, trailer, patch-id or subject; gaps are named", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-coverage-"));
  spawnSync("git", ["init", "-q", "-b", "main", dir]);
  const base = commitAs(dir, "owner", "a.txt", "base\n", "base");
  git(dir, "checkout", "-q", "-b", "seat");
  const c1 = commitAs(dir, "seat-1", "one.txt", "one\n", "one: first change");
  const c2 = commitAs(dir, "seat-1", "two.txt", "two\n", "two: second change");
  const c5 = commitAs(dir, "seat-2", "a.txt", "base\nfive\n", "five: edits a.txt");
  git(dir, "checkout", "-q", "-b", "integration", base);
  commitAs(dir, "seat-3", "a.txt", "base\nother\n", "other: conflicts with five"); // c3: nobody reviewed it
  assert.equal(pick(dir, c1), 0); // clean pick, no trailer: patch-id
  assert.equal(pick(dir, c2, "-x"), 0); // trailer
  assert.notEqual(pick(dir, c5), 0); // conflicts: resolved by hand, so its patch differs from c5's
  writeFileSync(join(dir, "a.txt"), "base\nother\nfive\n");
  git(dir, "add", "a.txt");
  git(dir, "-c", "core.editor=true", "cherry-pick", "--continue");
  const log = join(dir, "room.jsonl");
  const ev = (key: string, by: string, text: string) => JSON.stringify({ type: "board", room: "r", key, entry: { text, by, updatedAt: "2026-10-11T18:00:00.000Z" } });
  writeFileSync(log, [
    ev(`review/${c1.slice(0, 8)}`, "seat-2", head(c1.slice(0, 8))),
    ev(`review/${c2.slice(0, 8)}`, "seat-1", head(c2.slice(0, 8))), // the author reviewing their own commit
    ev(`verify/five`, "seat-3", head(c5.slice(0, 8), { exit_code: 1 })), // fails
    ev(`review/${c5.slice(0, 8)}`, "seat-1", head(c5.slice(0, 8))),
    ev("review/gone", "seat-2", head("deadbeef1")),
    JSON.stringify({ type: "board", room: "r", key: "review/gone", entry: null }), // cleared
    ev("review/prose", "seat-2", "looked at it, fine"),
  ].join("\n") + "\n");
  const r = reviewCoverage({ repo: dir, range: `${base}..integration`, board: boardFromLog(log) });
  const by = Object.fromEntries(r.commits.map((c) => [c.subject.split(":")[0], c]));
  assert.deepEqual(r.commits.map((c) => c.subject.split(":")[0]), ["other", "one", "two", "five"], "oldest first, every commit on the range");
  assert.equal(by.other.status, "unreviewed");
  assert.deepEqual([by.one.status, by.one.reviews.map((x) => [x.key, x.via])], ["reviewed", [[`review/${c1.slice(0, 8)}`, "patch-id"]]]);
  assert.deepEqual([by.two.status, by.two.reviews.map((x) => [x.via, x.self])], ["self-reviewed", [["trailer", true]]]);
  assert.equal(by.five.status, "reviewed", "seat-1 reviewed seat-2's commit; the failing head by seat-3 is listed, not counted");
  assert.deepEqual(by.five.reviews.map((x) => [x.key, x.via, x.passes]).sort(), [[`review/${c5.slice(0, 8)}`, "subject", true], ["verify/five", "subject", false]].sort());
  assert.deepEqual(r.summary, { commits: 4, reviewed: 2, self_reviewed: 1, failing_only: 0, unreviewed: 1 });
});
