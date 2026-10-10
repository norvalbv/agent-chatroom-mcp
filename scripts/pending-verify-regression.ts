/**
 * A verify entry written before any proposal existed ("proposal":"pending", or a slug) covers the commit it checked
 * in a proposal that cites it (swarm-082539-kns2, idea/pending-verify-counts; round-1 remaining/verification item 3).
 * Builds are reviewed while no proposal is open: in that room 11 of 11 verify heads named "pending" or a slug, and in
 * round 1 243 passing heads named no real proposal. unverifiedCommits required head.proposal === pr.id, so a final
 * list citing ten reviewed commits reported ten unchecked ones. Verification binds to the commit
 * (done-means-independently-verified). Coverage only: the gate still needs a head naming the proposal, so a pending
 * head on one small cited fix never unlocks a whole list (verifier, #287); and so it is never credited in the
 * "Verified" line for a commit the list cites as reverted (attack/idea/pending-verify-counts, -4).
 * Run: npx tsx --test scripts/pending-verify-regression.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Hub } from "../src/hub.js";

const X = "a1b2c3d4e5", Y = "f6e5d4c3b2";

function fixture(t: { after: (fn: () => void) => void }) {
  const hub = new Hub();
  const name = "pending-verify";
  const a = hub.join(name, "Alice", "test", { requireVerification: true, requireChallenge: false, expectedParticipants: 3 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "session-b").participant;
  const c = hub.join(name, "Carol", "test", {}, undefined, "session-c").participant;
  const room = hub.getRoom(name);
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  const head = (commit: string, proposal = "pending", over: Record<string, unknown> = {}) =>
    JSON.stringify({ proposal, command: "npx tsx scripts/x.ts", cwd: "/w", base_commit: "0123abc", base_exit_code: 1, commit, exit_code: 0, output_tail: "ok", ...over });
  return { hub, room, a, b, c, head };
}

test("pending heads written while builds were reviewed cover the commits the list cites, and their gaps ride on it", (t) => {
  const { hub, room, a, b, c, head } = fixture(t);
  hub.setBoard(room.name, a.id, "verify/own", "author's own run");
  hub.setBoard(room.name, b.id, "verify/x", head(X, "pending", { unverified: ["no dev room"] }));
  hub.setBoard(room.name, c.id, "verify/y", head(Y, "seat-targets")); // a slug, as one seat wrote
  const pr = hub.propose(room.name, a.id, `1. built ${X}. 2. built ${Y}.`);
  assert.deepEqual(hub.unverifiedCommits(room, pr), [], "both reviewed commits are covered, not reported as unchecked");
  assert.deepEqual(hub.verificationGaps(room, pr), [{ key: "verify/x", by: "Bob", gaps: ["no dev room"] }], "a covering head's own gaps are carried");
});

test("coverage never opens the gate: that still takes a head naming the proposal", (t) => {
  const { hub, room, a, b, c, head } = fixture(t);
  hub.setBoard(room.name, a.id, "verify/own", "author's own run");
  hub.setBoard(room.name, b.id, "verify/x", head(X));
  const pr = hub.propose(room.name, a.id, `1. built ${X}. 2. merged on integration ${Y}.`);
  assert.equal(hub.verifiedBy(room, pr), undefined, "a pending head on one cited commit must not unlock the list");
  assert.deepEqual(hub.unverifiedCommits(room, pr), [Y]);
  hub.setBoard(room.name, c.id, "verify/final", head(Y, pr.id));
  assert.equal(hub.verifiedBy(room, pr)?.by, "Carol");
  assert.deepEqual(hub.unverifiedCommits(room, pr), []);
});

test("no coverage for an uncited commit, a head naming another proposal, or the proposer's own; an amend dropping the commit drops it", (t) => {
  const { hub, room, a, b, head } = fixture(t);
  hub.setBoard(room.name, a.id, "verify/own", head(Y));
  hub.setBoard(room.name, b.id, "verify/x", head(X, "prop_deadbeef"));
  hub.setBoard(room.name, b.id, "verify/z", head("0a0b0c0d0e"));
  const pr = hub.propose(room.name, a.id, `built ${X} and ${Y}.`);
  assert.deepEqual(hub.unverifiedCommits(room, pr), [X, Y]);
  hub.setBoard(room.name, b.id, "verify/y", head(Y));
  assert.deepEqual(hub.unverifiedCommits(room, pr), [X]);
  hub.amend(room.name, a.id, pr.id, `built ${X} and ${Y}.`, `built ${X}.`);
  assert.deepEqual(hub.pendingCoverage(room, pr), []);
});
