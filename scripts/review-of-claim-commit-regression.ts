/**
 * A per-commit review settles the review a claim is owed (friction seen in swarm-180216-182a: this room's rule 2 asks
 * for review/<short-sha> entries, and the hub kept telling the assigned reviewer of claim/telemetry-outcome-health
 * "you ... have posted no review of it" after it had written review/0feee53b, review/a685ba0d and review/3b82e7fd).
 * reviewedClaim looked only at key names and text (the area, the claim, the branch). A verify/* or review/* entry by
 * another seat whose head names a commit on the claim owner's branch is now a review of that claim.
 * Run: npx tsx --test scripts/review-of-claim-commit-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";
import { openWork } from "../src/hub/open-work.js";

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-C", dir, "-c", "user.email=x@swarm.local", "-c", "user.name=seat-a", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

test("a review/<sha> of a commit on the owner's branch is a review of the claim; one of another branch is not", (t) => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "review-claim-")));
  spawnSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "a.txt"), "a\n"); git(repo, "add", "a.txt"); git(repo, "commit", "-q", "-m", "base");
  git(repo, "checkout", "-q", "-b", "swarm/run/seat-a");
  writeFileSync(join(repo, "b.txt"), "b\n"); git(repo, "add", "b.txt"); git(repo, "commit", "-q", "-m", "telemetry: health samples");
  const mine = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-q", "-b", "other", "main");
  writeFileSync(join(repo, "c.txt"), "c\n"); git(repo, "add", "c.txt"); git(repo, "commit", "-q", "-m", "someone else");
  const theirs = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-q", "swarm/run/seat-a");

  const hub = new Hub();
  const a = hub.join("rc", "seat-a", "claude", { nudgeAfterMs: 0 }, undefined, "s-a").participant;
  const r = hub.join("rc", "reviewer", "claude", {}, undefined, "s-r").participant;
  const room = hub.getRoom("rc");
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  hub.bindSeat("key-a", "s-a", repo);
  hub.setBoard("rc", a.id, "claim/telemetry-outcome-health", JSON.stringify({ area: "telemetry-outcome-health", owner: "seat-a", team: ["seat-a"], status: "open", note: "health samples" }));
  assert.equal(room.board.get("claim/telemetry-outcome-health")!.reviewerId, r.id);
  hub.setBoard("rc", a.id, "decision/telemetry-outcome-health", "health samples once a minute; built as the commit on swarm/run/seat-a");
  const owed = () => openWork(hub, room, r).some((w) => w.kind === "review_owed");
  assert.equal(owed(), true, "nothing reviewed yet");
  const head = (commit: string) => JSON.stringify({ proposal: "pending", command: "npx tsx probe.ts", cwd: "/tmp/x", base_commit: "0123abc", base_exit_code: 1, commit: commit.slice(0, 8), exit_code: 0, output_tail: "ok" });
  hub.setBoard("rc", r.id, `review/${theirs.slice(0, 8)}`, head(theirs));
  assert.equal(owed(), true, "a review of a commit on another branch is not a review of this claim");
  hub.setBoard("rc", r.id, `review/${mine.slice(0, 8)}`, head(mine));
  assert.equal(owed(), false, "a review of a commit on the owner's branch settles it");
});
