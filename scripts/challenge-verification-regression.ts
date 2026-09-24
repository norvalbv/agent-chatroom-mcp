/** Regression: npx tsx --test scripts/challenge-verification-regression.ts
 * Under requireChallenge "auto", a room that requires verification still needs a challenge. Room
 * swarm-092653-202z proposed letting the verify/* run replace it; the owner held that change on 2026-09-23
 * because verify entries mostly report re-running the author's own checks (consensus-requires-scrutiny). */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub, type RoomOptions } from "../src/hub.js";

const text = "Keep the mandatory challenge even when a verify run gates the proposal.";
function fixture(t: { after: (fn: () => void) => void }, opts: RoomOptions) {
  const dir = mkdtempSync(join(tmpdir(), "challenge-verification-"));
  const hub = new Hub({ dataDir: dir });
  hub.createRoom("regression", opts);
  const a = hub.join("regression", "Alice", "test", {}, undefined, "session-a").participant;
  const b = hub.join("regression", "Bob", "test", {}, undefined, "session-b").participant;
  const c = hub.join("regression", "Carol", "test", {}, undefined, "session-c").participant;
  const room = hub.getRoom("regression");
  t.after(() => {
    clearTimeout(room.nudgeTimer);
    clearTimeout(room.openingsTimer);
    rmSync(dir, { recursive: true, force: true });
  });
  if (opts.requireVerification) hub.setBoard(room.name, a.id, "verify/author", JSON.stringify({ proposal: "pending", command: "npm test", cwd: ".", exit_code: 0, output_tail: "ok" }));
  const pr = hub.propose(room.name, a.id, text);
  const verify = () =>
    hub.setBoard(room.name, b.id, "verify/cut", JSON.stringify({ proposal: pr.id, command: "npm test", cwd: ".", base_commit: "a1b2c3d", base_exit_code: 1, commit: "e4f5a6b", exit_code: 0, output_tail: "ok" }));
  const agreeAll = () => {
    for (const p of [b, c]) hub.vote(room.name, p.id, pr.id, "agree", undefined, undefined, text);
  };
  return { hub, room, pr, a, b, c, verify, agreeAll };
}

test("auto + verification: votes and a verify run are not enough without a challenge", (t) => {
  const { hub, room, pr, verify, agreeAll } = fixture(t, { requireVerification: true });
  assert.equal(hub.challengeRequired(room), true);
  verify();
  assert.ok(hub.verifiedBy(room, pr), "the verify run counts (fail-to-pass), so only the missing challenge holds the room");
  agreeAll();
  assert.equal(pr.challenges.length, 0);
  assert.equal(room.state, "open");
});

test("auto + verification: the verify gate still holds without a run", (t) => {
  const { room, agreeAll } = fixture(t, { requireVerification: true });
  agreeAll();
  assert.equal(room.state, "open");
});

test("auto without verification: challenge still required", (t) => {
  const { hub, room, agreeAll } = fixture(t, {});
  assert.equal(hub.challengeRequired(room), true);
  agreeAll();
  assert.equal(room.state, "open");
});

test("explicit requireChallenge true wins over verification", (t) => {
  const { hub, room, verify, agreeAll } = fixture(t, { requireVerification: true, requireChallenge: true });
  assert.equal(hub.challengeRequired(room), true);
  verify();
  agreeAll();
  assert.equal(room.state, "open");
});

test("auto + verification: a challenge someone does file still blocks until answered", (t) => {
  const { hub, room, pr, b, c, verify } = fixture(t, { requireVerification: true, quorum: "majority" });
  hub.challenge(room.name, c.id, pr.id, `"${text.slice(0, 40)}" is not backed by a run.`);
  verify();
  hub.vote(room.name, b.id, pr.id, "agree", "The verify run covers this; the objection is about wording only.", undefined, text);
  assert.equal(room.state, "open");
  assert.equal(pr.challenges[0].status ?? "open", "open");
});
