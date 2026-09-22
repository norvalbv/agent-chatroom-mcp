/**
 * Vote-to-kick regressions (item 1 of swarm-140818-f1qy). Run: npx tsx scripts/kick-vote-regression.ts
 *
 * Covers: threshold = quorumNeeded over the other voters, ballots per connection, target cannot vote,
 * removal marks left + releases claim/* + refuses the kicked seat's next calls + blocks rejoin (name and
 * connection), the electorate no longer waits on the kicked seat, human keep vetoes, replay keeps the
 * kicked record, and the existing gates (leave refusal, room-of-one floor) are untouched.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const ROOM = "kick-regression";
const TEXT = "Adopt the kick primitive as the single removal path.";
const QUOTE = "single removal path";

function fourSeats(dataDir?: string) {
  const hub = new Hub({ dataDir });
  const opts = { requireChallenge: false, nudgeAfterMs: 0, quorum: "supermajority" as const, expectedParticipants: 4 };
  const a = hub.join(ROOM, "A", "test", opts, undefined, "s1").participant;
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const c = hub.join(ROOM, "C", "test", {}, undefined, "s3").participant;
  const d = hub.join(ROOM, "D", "test", {}, undefined, "s4").participant;
  const room = hub.getRoom(ROOM);
  return { hub, room, a, b, c, d };
}

test("threshold: quorumNeeded over the other voters; starting counts as a ballot; the target may not vote", () => {
  const { hub, room, a, b, c, d } = fourSeats();
  assert.throws(() => hub.kickVote(ROOM, a.id, "A", "kick", "self"), /cannot vote to kick yourself/);
  assert.throws(() => hub.kickVote(ROOM, a.id, "D", "keep"), /no open vote/);
  assert.throws(() => hub.kickVote(ROOM, a.id, "D", "kick", "short"), /needs a reason/);
  const kv = hub.kickVote(ROOM, a.id, "D", "kick", "no heartbeat for 15 min per room_status");
  assert.equal(kv.status, "open");
  const view = hub.kickView(room, kv);
  // pool = A,B,C (3 voters minus target) -> supermajority = ceil(2.25) = 3
  assert.equal(view.needed, 3);
  assert.equal(view.kick, 1);
  assert.throws(() => hub.kickVote(ROOM, d.id, "D", "keep"), /cannot vote to kick yourself/);
  hub.kickVote(ROOM, b.id, "D", "kick");
  assert.equal(room.participants.get(d.id)!.active, true, "2 of 3 must not remove");
  hub.kickVote(ROOM, c.id, "D", "kick");
  assert.equal(kv.status, "kicked");
  assert.equal(room.participants.get(d.id)!.active, false);
  assert.ok(room.participants.get(d.id)!.kicked, "kicked record set");
  assert.ok(room.messages.some((m) => m.kind === "system" && /D was removed from the room by a kick vote started by A/.test(m.content)));
});

test("ballots count per connection: two names on one session are one ballot", () => {
  const { hub, room, a, b, d } = fourSeats();
  const a2 = hub.join(ROOM, "A2", "test", {}, undefined, "s1").participant; // same connection as A
  const kv = hub.kickVote(ROOM, a.id, "D", "kick", "persistent disagreement blocking progress");
  hub.kickVote(ROOM, a2.id, "D", "kick");
  assert.equal(hub.kickView(room, kv).kick, 1, "same session counted once");
  assert.equal(room.participants.get(d.id)!.active, true);
  hub.kickVote(ROOM, b.id, "D", "kick");
  assert.equal(hub.kickView(room, kv).kick, 2);
  // pool = A, A2, B, C = 4 seats on 3 connections -> quorumNeeded(supermajority, 3) = 3
  assert.equal(hub.kickView(room, kv).needed, 3);
});

test("the pool is electorate() minus the target's whole connection: a sibling identity of the target neither votes nor raises the threshold", () => {
  const { hub, room, a, b, c, d } = fourSeats();
  const d2 = hub.join(ROOM, "D2", "test", {}, undefined, "s4").participant; // same connection as D
  const kv = hub.kickVote(ROOM, a.id, "D", "kick", "D's connection is dead: no heartbeat");
  assert.equal(hub.kickView(room, kv).needed, 3, "pool is A,B,C (3 connections): D2 shares D's connection and is not counted");
  assert.equal(hub.kickView(room, kv).eligible_connections, 3);
  assert.throws(() => hub.kickVote(ROOM, d2.id, "D", "keep"), /shares your connection/);
  hub.kickVote(ROOM, b.id, "D", "kick");
  hub.kickVote(ROOM, c.id, "D", "kick");
  assert.equal(kv.status, "kicked");
  assert.equal(room.participants.get(d.id)!.active, false);
  // the sibling is refused too: it is the same connection (join() blocks it; requireParticipant refuses the kicked seat)
  assert.throws(() => hub.join(ROOM, "D3", "test", {}, undefined, "s4"), /KICKED/);
  // the removed seat is refused even on a read-only path the guard resolves it for
  assert.throws(() => hub.refuseKicked(ROOM, d.id), /KICKED/);
  hub.refuseKicked(ROOM, a.id); // a live seat passes through
});

test("removal: claims released to anyone, further calls refused with KICKED, no rejoin by name or connection, electorate unstuck", () => {
  const { hub, room, a, b, c, d } = fourSeats();
  hub.setBoard(ROOM, d.id, "claim/thing", JSON.stringify({ area: "thing", owner: "D", status: "building" }));
  const pr = hub.propose(ROOM, a.id, TEXT);
  const kv = hub.kickVote(ROOM, a.id, "D", "kick", "dead session: last_seen_at 20 min ago");
  hub.kickVote(ROOM, b.id, "D", "kick");
  hub.kickVote(ROOM, c.id, "D", "kick");
  assert.equal(kv.status, "kicked");
  const released = room.board.get("claim/thing")!;
  assert.equal(released.by, "system");
  assert.equal((JSON.parse(released.text) as { status: string }).status, "released");
  assert.ok(room.messages.some((m) => m.kind === "system" && /Released 1 claim\/\* entry \(claim\/thing\)/.test(m.content)), "one system line names the released claims");
  // anyone may now take the area
  hub.setBoard(ROOM, b.id, "claim/thing", JSON.stringify({ area: "thing", owner: "B", status: "building" }));
  assert.equal(room.board.get("claim/thing")!.by, "B");
  // the kicked seat's next calls are refused with a clear error
  assert.throws(() => hub.send(ROOM, d.id, "still here"), /KICKED: you \(D\) were removed/);
  assert.throws(() => hub.setBoard(ROOM, d.id, "note", "x"), /KICKED/);
  assert.throws(() => hub.vote(ROOM, d.id, pr.id, "agree", undefined, undefined, QUOTE), /KICKED/);
  assert.throws(() => hub.kickVote(ROOM, d.id, "A", "kick", "revenge is a reason"), /KICKED/);
  // no rejoin under the old name, the old id, or a new name on the same connection
  assert.throws(() => hub.join(ROOM, "D", "test", {}, undefined, "s4"), /KICKED/);
  assert.throws(() => hub.join(ROOM, "D", "test", {}, d.id, "s9"), /KICKED/);
  assert.throws(() => hub.join(ROOM, "D-again", "test", {}, undefined, "s4"), /KICKED/);
  // a fresh connection with a fresh name is fine (a genuine replacement)
  hub.join(ROOM, "E", "test", {}, undefined, "s5");
  // status shows the kicked record and the settled vote
  const s = hub.summary(room);
  assert.deepEqual(s.participants.find((p) => p.name === "D")!.kicked!.reason, "dead session: last_seen_at 20 min ago");
  assert.equal(s.kick_votes[0].status, "kicked");
});

test("quorum no longer waits on the kicked seat (unanimous room, expected_participants = 4)", () => {
  const hub = new Hub();
  const opts = { requireChallenge: false, nudgeAfterMs: 0, quorum: "unanimous" as const, expectedParticipants: 4 };
  const a = hub.join(ROOM, "A", "test", opts, undefined, "s1").participant;
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const c = hub.join(ROOM, "C", "test", {}, undefined, "s3").participant;
  hub.join(ROOM, "D", "test", {}, undefined, "s4");
  const room = hub.getRoom(ROOM);
  const pr = hub.propose(ROOM, a.id, TEXT);
  const agree = (id: string) => hub.vote(ROOM, id, pr.id, "agree", undefined, undefined, QUOTE);
  agree(b.id);
  agree(c.id);
  assert.equal(room.state, "open", "unanimous: D's vote is awaited");
  assert.ok(hub.proposalView(room, pr).waiting_on.includes("D"));
  hub.kickVote(ROOM, a.id, "D", "kick", "unresponsive: no hub call for 25 min");
  hub.kickVote(ROOM, b.id, "D", "kick");
  hub.kickVote(ROOM, c.id, "D", "kick");
  assert.equal(room.participants.size, 4);
  assert.equal(room.expectedParticipants, 4, "expected_participants is untouched: unarrived() counts arrivals, and D arrived");
  assert.equal(hub.unarrived(room), 0);
  assert.equal(room.state, "concluded", "the proposal concludes without D once D is removed");
  assert.equal(room.conclusion!.electorate!.excluded_leavers, 1);
});

test("keep ballots that make the threshold unreachable drop the vote; a human keep vetoes; a settled vote can be restarted", () => {
  const { hub, room, a, b, c, d } = fourSeats();
  const kv = hub.kickVote(ROOM, a.id, "D", "kick", "blocking progress on the design");
  hub.kickVote(ROOM, b.id, "D", "keep");
  assert.equal(kv.status, "dropped", "pool 3, needed 3, one keep -> unreachable");
  assert.equal(room.participants.get(d.id)!.active, true);
  const kv2 = hub.kickVote(ROOM, a.id, "D", "kick", "blocking progress on the design, again");
  assert.notEqual(kv2, kv);
  assert.equal(kv2.status, "open");
  const human = hub.join(ROOM, "benji", "human", {}, undefined, "http:benji").participant;
  hub.kickVote(ROOM, human.id, "D", "keep");
  assert.equal(kv2.status, "dropped");
  assert.match(kv2.outcome!, /human voted keep/);
  // a human kick ballot counts toward the threshold like an agent's
  const kv3 = hub.kickVote(ROOM, a.id, "D", "kick", "third time: still blocking");
  hub.kickVote(ROOM, human.id, "D", "kick");
  hub.kickVote(ROOM, b.id, "D", "kick");
  assert.equal(kv3.status, "kicked");
  assert.equal(room.participants.get(d.id)!.active, false);
  assert.throws(() => hub.kickVote(ROOM, a.id, "benji", "kick", "kick the human"), /cannot be voted out/);
  assert.throws(() => hub.kickVote(ROOM, a.id, "D", "kick", "kick again please"), /already removed/);
  void c;
});

test("never one ballot alone: a two-seat room cannot kick without a human; with one, agent + human reach 2", () => {
  const hub = new Hub();
  const a = hub.join(ROOM, "A", "test", { requireChallenge: false, nudgeAfterMs: 0 }, undefined, "s1").participant;
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const room = hub.getRoom(ROOM);
  assert.throws(() => hub.kickVote(ROOM, a.id, "B", "kick", "session dead: no heartbeat"), /needs 2 ballots from distinct connections/);
  assert.equal(room.kickVotes.size, 0, "a refused start leaves no vote behind");
  const human = hub.join(ROOM, "benji", "human", {}, undefined, "http:benji").participant;
  const kv = hub.kickVote(ROOM, a.id, "B", "kick", "session dead: no heartbeat");
  assert.equal(kv.status, "open");
  assert.equal(hub.kickView(room, kv).needed, 2);
  hub.kickVote(ROOM, human.id, "B", "kick");
  assert.equal(kv.status, "kicked");
  assert.equal(room.participants.get(b.id)!.active, false);
  // unanimous rooms need every other connection
  const hub2 = new Hub();
  const a2 = hub2.join(ROOM, "A", "test", { requireChallenge: false, nudgeAfterMs: 0, quorum: "unanimous" }, undefined, "s1").participant;
  hub2.join(ROOM, "B", "test", {}, undefined, "s2");
  hub2.join(ROOM, "C", "test", {}, undefined, "s3");
  hub2.join(ROOM, "D", "test", {}, undefined, "s4");
  hub2.join(ROOM, "E", "test", {}, undefined, "s5");
  const kv2 = hub2.kickVote(ROOM, a2.id, "E", "kick", "unanimous rooms need everyone else");
  assert.equal(hub2.kickView(hub2.getRoom(ROOM), kv2).needed, 4);
});

test("kick votes and the kicked record survive replay; the kicked seat is still refused after a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "kick-"));
  try {
    const { hub, a, b, c } = fourSeats(dir);
    hub.kickVote(ROOM, a.id, "D", "kick", "dead: no hub call for 30 min");
    hub.kickVote(ROOM, b.id, "D", "kick");
    hub.kickVote(ROOM, c.id, "D", "kick");
    const hub2 = new Hub({ dataDir: dir });
    const room2 = hub2.getRoom(ROOM);
    const d2 = [...room2.participants.values()].find((p) => p.name === "D")!;
    assert.ok(d2.kicked);
    assert.equal(room2.kickVotes.size, 1);
    assert.equal([...room2.kickVotes.values()][0].status, "kicked");
    assert.throws(() => hub2.join(ROOM, "D", "test", {}, undefined, "s4"), /KICKED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing gates untouched: leave_room refusal for an orphaned claim, room-of-one floor, concluded room refuses kicks", () => {
  const { hub, room, a, b, c, d } = fourSeats();
  hub.setBoard(ROOM, a.id, "claim/x", JSON.stringify({ area: "x", owner: "A", status: "building" }));
  assert.match(hub.leaveRefusal(room, a)!, /you still own claim\/x/);
  const pr = hub.propose(ROOM, b.id, TEXT);
  hub.vote(ROOM, c.id, pr.id, "agree", undefined, undefined, QUOTE);
  hub.vote(ROOM, d.id, pr.id, "agree", undefined, undefined, QUOTE);
  assert.equal(room.state, "concluded");
  assert.throws(() => hub.kickVote(ROOM, a.id, "B", "kick", "too late to kick anyone"), /concluded/);
});
