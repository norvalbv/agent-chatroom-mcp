/** Supermajority quorum: a room can require ceil(0.75*electorate) agrees instead of a bare majority,
 * every count still reading the single electorate() helper (docs/decisions/board-delta-manifests-and-single-electorate.md).
 * Run: npx tsx scripts/quorum-supermajority-regression.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub } from "../src/hub.js";
import { floorFor, type RespawnRoom } from "../src/respawn.js";

const TEXT = "Require independent evidence before adopting this conclusion.";
const QUOTE = "before adopting this conclusion";
const ROOM = "quorum-supermajority";

function setup(quorum: "majority" | "supermajority", n: number) {
  const hub = new Hub();
  const { room, participant: a } = hub.join(ROOM + "-" + quorum + "-" + n, "A", "test", { quorum, requireChallenge: true, nudgeAfterMs: 0 }, undefined, "s1");
  const others = Array.from({ length: n - 1 }, (_, i) => hub.join(room.name, String.fromCharCode(66 + i), "test", {}, undefined, `s${i + 2}`).participant);
  const pr = hub.propose(room.name, a.id, TEXT);
  hub.challenge(room.name, others[0].id, pr.id, `"independent evidence" needs a checked source.`);
  const agree = (id: string) => hub.vote(room.name, id, pr.id, "agree", "Checked independently.", undefined, QUOTE);
  return { hub, room, a, others, pr, agree };
}

test("5-voter supermajority needs 4 agrees (ceil(0.75*5)); 3 is not enough, unlike majority's 3", () => {
  const { hub, room, others, agree } = setup("supermajority", 5);
  // A already agrees (proposer auto-vote). B challenged (still owes its own vote).
  agree(others[0].id); // 2 agree
  assert.equal(room.state, "open");
  agree(others[1].id); // 3 agree: majority's threshold, but supermajority needs 4
  assert.equal(room.state, "open", "3/5 must not satisfy a 75% supermajority");
  const pr = [...room.proposals.values()][0];
  assert.ok(hub.blockedBy(room, pr).some((r) => /votes from/.test(r)), "still waiting on unvoted members");
  agree(others[2].id); // 4 agree: ceil(0.75*5) reached, before the 5th voter ever votes
  assert.equal(room.state, "concluded");
  assert.deepEqual(room.conclusion?.tally, { agree: 4, disagree: 0, abstain: 0 });
  assert.equal(room.conclusion?.electorate.electorate, 5, "denominator is the electorate() helper, all 5 voters");
  assert.match(room.messages.find((m) => m.kind === "conclusion")!.content, /quorum=supermajority/);
});

test("5-voter plain majority still only needs 3 agrees (unaffected by generalising the threshold)", () => {
  const { room, others, agree } = setup("majority", 5);
  agree(others[0].id); // 2 agree
  assert.equal(room.state, "open");
  agree(others[1].id); // 3 agree: majority threshold
  assert.equal(room.state, "concluded");
  assert.deepEqual(room.conclusion?.tally, { agree: 3, disagree: 0, abstain: 0 });
  assert.match(room.messages.find((m) => m.kind === "conclusion")!.content, /quorum=majority/);
});

test("floorFor: supermajority keeps max(3, ceil(0.75*expected)), distinct from majority's ceil(expected/2)", () => {
  const base: RespawnRoom = { state: "open", expected_participants: 20, participants: [], board: {}, proposals: [{ status: "open" }] };
  assert.equal(floorFor({ ...base, quorum: "supermajority" }), 15);
  assert.equal(floorFor({ ...base, quorum: "majority" }), 10);
  assert.equal(floorFor({ ...base, quorum: "unanimous" }), 20);
  // small rooms still floor at MIN_FLOOR (3)
  assert.equal(floorFor({ ...base, quorum: "supermajority", expected_participants: 2 }), 3);
});

test("createRoom and hub.join accept quorum=\"supermajority\" and the room carries it", () => {
  const hub = new Hub();
  const room = hub.createRoom("quorum-supermajority-create", { quorum: "supermajority" });
  assert.equal(room.quorum, "supermajority");
});
