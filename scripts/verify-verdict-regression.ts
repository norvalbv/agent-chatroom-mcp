/**
 * Rank 1 of the peer-review plan (swarms/swarm-100622-6jdx/report.md): verifiedBy() was content-blind — a
 * verify/* entry that said "BLOCKED, tests fail" satisfied require_verification exactly like a real pass,
 * because the hub only ever checked author/session/freshness/naming, never the verdict itself (3 of 37
 * verify entries in the measured runs self-reported PARTIAL/BLOCKED/NOT GREEN and still passed the gate).
 * Fix: verify/* must lead with one line of JSON {proposal,command,cwd,exit_code,output_tail,commit?}
 * (docs/swarm-protocol-spec.md:26, section C.3) and only exit_code===0 naming the right proposal counts.
 * Run: npx tsx --test scripts/verify-verdict-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub, parseVerifyHead, VERIFY_HEAD_EXAMPLE } from "../src/hub.js";

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "verify-verdict-"));
  const hub = new Hub({ dataDir: dir });
  const name = "verify-verdict-test";
  const a = hub.join(name, "Alice", "test", { requireVerification: true, requireChallenge: false, expectedParticipants: 2 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "session-b").participant;
  const room = hub.getRoom(name);
  // propose()'s own precondition just checks presence of any verify/ key (untyped); the content-blind gate
  // this regression targets is the accept-time verifiedBy() check, exercised separately below.
  hub.setBoard(name, a.id, "verify/placeholder", "will be replaced before voting");
  const pr = hub.propose(name, a.id, "Ship the fix as tested.");
  t.after(() => {
    clearTimeout(room.nudgeTimer);
    clearTimeout(room.openingsTimer);
    rmSync(dir, { recursive: true, force: true });
  });
  return { hub, room, pr, a, b };
}

test("parseVerifyHead: rejects free text, requires the typed shape", () => {
  assert.equal(parseVerifyHead("BLOCKED: tests fail"), undefined);
  assert.equal(parseVerifyHead("ran: npm test (cwd /tmp/x, commit abc) exit 0"), undefined);
  assert.equal(parseVerifyHead("{not json"), undefined);
  assert.equal(parseVerifyHead('{"proposal":"p1","command":"npm test","cwd":"/repo"}'), undefined, "missing exit_code/output_tail");
  assert.equal(parseVerifyHead('{"proposal":"p1","command":"npm test","cwd":"/repo","exit_code":"0","output_tail":"ok"}'), undefined, "exit_code must be a number, not a string");
  const head = parseVerifyHead('{"proposal":"p1","command":"npm test","cwd":"/repo","exit_code":0,"output_tail":"9 passed"}\nfollow-up prose is fine');
  assert.deepEqual(head, { proposal: "p1", command: "npm test", cwd: "/repo", exit_code: 0, output_tail: "9 passed" });
});

test("a self-declared BLOCKED/PARTIAL verdict does not satisfy verifiedBy() (the 3/37 case)", (t) => {
  const { hub, room, pr, b } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/area", `BLOCKED: build fails, not fixed yet. See ${pr.id}.`);
  assert.equal(hub.verifiedBy(room, pr), undefined, "free-text verdict, however it names the proposal, must not count");
  assert.ok(hub.blockedBy(room, pr).some((m) => m.includes(VERIFY_HEAD_EXAMPLE.slice(0, 12))), "the refusal names the required JSON head");
});

test("a parseable head with exit_code !== 0 does not satisfy verifiedBy()", (t) => {
  const { hub, room, pr, b } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/area", JSON.stringify({ proposal: pr.id, command: "npm test", cwd: "/repo", exit_code: 1, output_tail: "2 failed" }));
  assert.equal(hub.verifiedBy(room, pr), undefined, "a real but failing run must not satisfy the gate");
});

test("a head naming a different proposal id does not satisfy verifiedBy()", (t) => {
  const { hub, room, pr, b } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/area", JSON.stringify({ proposal: "prop_other", command: "npm test", cwd: "/repo", exit_code: 0, output_tail: "ok" }));
  assert.equal(hub.verifiedBy(room, pr), undefined);
});

test("a valid pass head by a different connection satisfies verifiedBy() and clears the gate", (t) => {
  const { hub, room, pr, a, b } = fixture(t);
  assert.ok(hub.blockedBy(room, pr).some((m) => m.startsWith("a verify/* board entry")), "blocked before any verify entry exists");
  hub.setBoard(room.name, b.id, "verify/area", JSON.stringify({ proposal: pr.id, command: "npm test", cwd: "/repo", exit_code: 0, output_tail: "9 passed, 0 failed" }));
  const entry = hub.verifiedBy(room, pr);
  assert.ok(entry, "a real pass naming this proposal counts");
  assert.equal(hub.blockedBy(room, pr).some((m) => m.startsWith("a verify/* board entry")), false);
  hub.vote(room.name, a.id, pr.id, "agree", undefined, undefined, "Ship the fix as tested");
  hub.vote(room.name, b.id, pr.id, "agree", undefined, undefined, "Ship the fix as tested");
  assert.equal(room.state, "concluded", "with a valid verify head and both agrees, the proposal actually concludes");
});

test("the proposer's own valid head still does not count (author check is unchanged)", (t) => {
  const { hub, room, pr, a } = fixture(t);
  hub.setBoard(room.name, a.id, "verify/area", JSON.stringify({ proposal: pr.id, command: "npm test", cwd: "/repo", exit_code: 0, output_tail: "9 passed" }));
  assert.equal(hub.verifiedBy(room, pr), undefined, "self-verification must not satisfy the gate");
});
