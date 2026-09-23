/** Regression: npx tsx --test scripts/challenge-verification-regression.ts
 * Under requireChallenge "auto", a room that requires verification needs no challenge: the non-author
 * verify/* run is the scrutiny. Without verification, or with an explicit true, the challenge gate stays. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub, type RoomOptions } from "../src/hub.js";

const text = "Cut the mandatory challenge when a verify run already gates the proposal.";
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
    hub.setBoard(room.name, b.id, "verify/cut", JSON.stringify({ proposal: pr.id, command: "npm test", cwd: ".", exit_code: 0, output_tail: "ok" }));
  const agreeAll = () => {
    for (const p of [b, c]) hub.vote(room.name, p.id, pr.id, "agree", undefined, undefined, text);
  };
  return { hub, room, pr, a, b, c, verify, agreeAll };
}

test("auto + verification: concludes on votes and a verify run, no challenge", (t) => {
  const { hub, room, pr, verify, agreeAll } = fixture(t, { requireVerification: true });
  assert.equal(hub.challengeRequired(room), false);
  verify();
  agreeAll();
  assert.equal(pr.challenges.length, 0);
  assert.equal(room.state, "concluded");
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
