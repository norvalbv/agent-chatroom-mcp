/**
 * A verify head whose base_commit is not a commit says so on the proposal and the conclusion (the verifier's dev room on
 * the full integration build, devroom/integration-verifier finding 3). The fail-to-pass gate needs a check that failed at
 * a parent commit; on a read-only answer there is none, and seats wrote git's empty tree (4b825dc6...) as base_commit
 * to pass it. The gate is self-reported by design (done-means-independently-verified) and stays as it is; what changes
 * is that the record no longer reads as an ordinary fail-to-pass: the empty tree, or a base_commit/commit the writer's
 * worktree does not hold (BoardEntry.commitCheck, 2ad8adec), is a named gap, so the conclusion says Verified PARTIAL.
 * Run: npx tsx --test scripts/base-not-a-commit-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Hub } from "../src/hub.js";

const repo = process.cwd();
const HEAD = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
const PARENT = spawnSync("git", ["-C", repo, "rev-parse", "HEAD~1"], { encoding: "utf8" }).stdout.trim();
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function room(t: { after: (fn: () => void) => void }) {
  const hub = new Hub();
  const name = "base-not-commit";
  const a = hub.join(name, "Alice", "claude", { requireVerification: true, requireChallenge: false, expectedParticipants: 2 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "claude", {}, undefined, "session-b").participant;
  hub.bindSeat("key-b", "session-b", repo);
  const r = hub.getRoom(name);
  t.after(() => { clearTimeout(r.nudgeTimer); clearTimeout(r.openingsTimer); });
  hub.setBoard(name, a.id, "verify/own", "author's own run");
  const pr = hub.propose(name, a.id, `The answer stands as of ${HEAD.slice(0, 8)}: nothing in the code changes.`);
  const head = (base: string) => JSON.stringify({ proposal: pr.id, command: "grep -c answer notes.md", cwd: repo, base_commit: base, base_exit_code: 1, commit: HEAD.slice(0, 8), exit_code: 0, output_tail: "1" });
  return { hub, r, a, b, pr, head };
}

test("git's empty tree as base_commit is a named gap on the proposal and the conclusion", (t) => {
  const { hub, r, b, pr, head } = room(t);
  hub.setBoard(r.name, b.id, "verify/answer", head(EMPTY_TREE));
  const gaps = hub.verificationGaps(r, pr).flatMap((g) => g.gaps);
  assert.ok(gaps.some((g) => /base_commit 4b825dc6 is git's empty tree, not a parent commit/.test(g)), JSON.stringify(gaps));
  hub.vote(r.name, b.id, pr.id, "agree", undefined, undefined, "nothing in the code changes");
  assert.equal(r.state, "concluded", "the gate is unchanged: the head still counts");
  assert.ok((r.conclusion!.verification_gaps ?? []).flatMap((g) => g.gaps).some((g) => /empty tree/.test(g)), "the conclusion carries it (Verified PARTIAL)");
});

test("a base_commit the writer's worktree does not hold is a gap; a real parent is not", (t) => {
  const { hub, r, b, pr, head } = room(t);
  hub.setBoard(r.name, b.id, "verify/ghost", head("ca10a76f"));
  assert.ok(hub.verificationGaps(r, pr).flatMap((g) => g.gaps).some((g) => /base_commit ca10a76f is not a commit in the reviewer's repository/.test(g)));
  hub.setBoard(r.name, b.id, "verify/ghost", head(PARENT.slice(0, 8)));
  assert.deepEqual(hub.verificationGaps(r, pr).flatMap((g) => g.gaps).filter((g) => /base_commit/.test(g)), [], "a real parent commit is no gap");
});
