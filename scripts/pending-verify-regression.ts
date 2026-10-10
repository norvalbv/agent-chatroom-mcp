/**
 * A verify entry written before any proposal existed ("proposal":"pending", or a slug) counts for a proposal whose text
 * cites the commit it checked (swarm-082539-kns2, idea/pending-verify-counts; round-1 remaining/verification item 3).
 * Builds are reviewed while no proposal is open: in that room 11 of 11 verify heads named "pending" or a slug, and in
 * round 1 243 passing heads named no real proposal. The gate, unverifiedCommits and candidateHeads all required
 * head.proposal === pr.id, so a final list citing ten reviewed commits read as ten unverified ones unless every
 * reviewer rewrote after the fact. Verification binds to the commit (done-means-independently-verified), so a pending
 * head binds the same way. A head naming another prop_ id still does not count.
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
  const head = (commit: string, proposal = "pending") =>
    JSON.stringify({ proposal, command: "npx tsx scripts/x.ts", cwd: "/w", base_commit: "0123abc", base_exit_code: 1, commit, exit_code: 0, output_tail: "ok" });
  return { hub, room, a, b, c, head };
}

test("pending heads written while builds were reviewed count for the list that cites their commits", (t) => {
  const { hub, room, a, b, c, head } = fixture(t);
  hub.setBoard(room.name, a.id, "verify/own", "author's own run");
  hub.setBoard(room.name, b.id, "verify/x", head(X));
  hub.setBoard(room.name, c.id, "verify/y", head(Y, "seat-targets")); // a slug, as one seat wrote
  const pr = hub.propose(room.name, a.id, `1. built ${X}. 2. built ${Y}.`);
  assert.ok(hub.verifiedBy(room, pr), "a pending head for a cited commit passes the gate");
  assert.deepEqual(hub.unverifiedCommits(room, pr), [], "both reviewed commits are covered, not reported as unverified");
  assert.equal(hub.proposalView(room, pr).blocked_by?.some((x: string) => /verif/i.test(x)) ?? false, false, JSON.stringify(hub.proposalView(room, pr).blocked_by));
});

test("a pending head does not count for a proposal that does not cite its commit, nor does one naming another proposal", (t) => {
  const { hub, room, a, b, head } = fixture(t);
  hub.setBoard(room.name, a.id, "verify/own", "author's own run");
  hub.setBoard(room.name, b.id, "verify/x", head(X, "prop_deadbeef"));
  hub.setBoard(room.name, b.id, "verify/y", head(Y));
  const pr = hub.propose(room.name, a.id, `built ${X}, nothing else.`);
  assert.equal(hub.verifiedBy(room, pr), undefined, "Y is not in the text; X's head names another proposal");
  assert.deepEqual(hub.unverifiedCommits(room, pr), [X]);
});

test("the proposer's own pending head still does not count, and an amend that drops the commit drops the entry", (t) => {
  const { hub, room, a, b, head } = fixture(t);
  hub.setBoard(room.name, a.id, "verify/own", head(X));
  const pr = hub.propose(room.name, a.id, `built ${X}.`);
  assert.equal(hub.verifiedBy(room, pr), undefined);
  hub.setBoard(room.name, b.id, "verify/x", head(X));
  assert.ok(hub.verifiedBy(room, pr));
  hub.amend(room.name, a.id, pr.id, `built ${X}.`, `built ${Y}.`);
  assert.equal(hub.verifiedBy(room, pr), undefined, "the commit it checked is gone from the text");
});
