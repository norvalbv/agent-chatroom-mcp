/** Challenge delta: wait_for_messages ships a challenge's objection once per (challenge, status), not on every wait.
 * kooz (swarm-083203) re-shipped 787k chars of unchanged objections across 478 waits, twice the proposal text.
 * Run against source: npx tsx --test scripts/challenge-delta-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";

const ROOM = "challenge-delta";
const OBJECTION = 'The clause "every double" is unproven: 1e-07 prints wrong.';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "challenge-delta-"));
  const hub = new Hub({ dataDir: dir });
  const a = hub.join(ROOM, "A", "test", { requireChallenge: true, quorum: "majority", nudgeAfterMs: 0 }, undefined, "s1").participant;
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const room = hub.getRoom(ROOM);
  const pr = hub.propose(ROOM, a.id, "Ship the formatter: it prints %.17g for every double.");
  t.after(() => {
    clearTimeout(room.nudgeTimer);
    clearTimeout(room.openingsTimer);
    rmSync(dir, { recursive: true, force: true });
  });
  return { hub, room, pr, a, b };
}

test("an objection ships on first sight, then only id/status until its status changes", (t) => {
  const { hub, room, pr, a, b } = fixture(t);
  hub.challenge(ROOM, b.id, pr.id, OBJECTION, true, "printf-check 1e-07");
  const view = () => hub.challengesDelta(a, hub.proposalView(room, pr).challenges);
  const first = view();
  assert.equal(first[0].objection, OBJECTION, "first sight carries the objection");
  const second = view();
  assert.ok(!("objection" in second[0]), "an unchanged challenge is not re-shipped");
  assert.match((second[0] as { objection_omitted?: string }).objection_omitted ?? "", /room_status/);
  assert.equal(second[0].status, "open");
  assert.equal((second[0] as { command?: string }).command, "printf-check 1e-07", "an executable command still travels: it must be rerun verbatim");
  assert.equal(hub.proposalView(room, pr).challenges[0].objection, OBJECTION, "proposalView (room_status) keeps the full text");
  pr.challenges[0].status = "answered";
  assert.equal(view()[0].objection, OBJECTION, "a status change re-ships the objection once");
  assert.ok(!("objection" in view()[0]));
});

test("delivery is per participant, and a second challenge ships on its own first sight", (t) => {
  const { hub, room, pr, a, b } = fixture(t);
  hub.challenge(ROOM, b.id, pr.id, OBJECTION, true, "printf-check 1e-07");
  hub.challengesDelta(a, hub.proposalView(room, pr).challenges);
  assert.equal(hub.challengesDelta(b, hub.proposalView(room, pr).challenges)[0].objection, OBJECTION, "B has not been sent it yet");
  hub.challenge(ROOM, b.id, pr.id, `${OBJECTION} Also 5e-324.`, false);
  const both = hub.challengesDelta(a, hub.proposalView(room, pr).challenges);
  assert.ok(!("objection" in both[0]) && both[1].objection?.includes("5e-324"));
});

test("a legacy challenge without an id always ships in full", () => {
  const p = { seenChallenges: {} } as Parameters<Hub["challengesDelta"]>[0];
  const hub = Object.create(Hub.prototype) as Hub;
  const legacy = [{ status: "open", objection: "old" }];
  hub.challengesDelta(p, legacy);
  assert.equal(hub.challengesDelta(p, legacy)[0].objection, "old");
});
