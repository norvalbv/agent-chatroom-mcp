/**
 * Per-seat output record (claim/seat-performance, swarm-000525-jcz8). Run: npx tsx scripts/seat-output-regression.ts
 *
 * Covers: room_status carries what each seat has put on the record (claims, evidence, verifies, proposals, challenges,
 * age of the last one), computed by the hub from its own state; a worker in the room past the window with nothing on the
 * record while most others have something is listed in no_output and told once; a seat doing the same in a room where
 * nobody uses the board is not; the verifier, the chair and humans are never listed; a kick vote announcement quotes the
 * target's record; the record survives a replay.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";
import { NO_OUTPUT_CLAIMED_MS, NO_OUTPUT_MS, warnNoOutput } from "../src/hub/output.js";

const ROOM = "seat-output-regression";
type Row = { name: string; output: { claims: number; evidence: number; verifies: number; proposals: number; challenges: number; age_seconds: number | null } };

function room4(dataDir?: string) {
  const hub = new Hub({ dataDir });
  const opts = { requireChallenge: false, nudgeAfterMs: 0, quorum: "supermajority" as const, expectedParticipants: 4 };
  const a = hub.join(ROOM, "A", "test", opts, undefined, "s1").participant;
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const c = hub.join(ROOM, "C", "test", {}, undefined, "s3").participant;
  const d = hub.join(ROOM, "D", "test", {}, undefined, "s4").participant;
  return { hub, room: hub.getRoom(ROOM), a, b, c, d };
}
const row = (hub: Hub, name: string) => (hub.summary(hub.getRoom(ROOM)).participants as unknown as Row[]).find((p) => p.name === name)!;
const listed = (hub: Hub) => (hub.summary(hub.getRoom(ROOM)) as unknown as { no_output: string[] }).no_output;
/** Everyone has been in the room longer than the window. */
const age = (hub: Hub, ms = NO_OUTPUT_MS) => { for (const p of hub.getRoom(ROOM).participants.values()) p.joinedAt = new Date(Date.now() - ms - 1000).toISOString(); };
const warnings = (hub: Hub, name: string) => hub.getRoom(ROOM).messages.filter((m) => m.kind === "system" && m.content.startsWith(`@${name} `) && /nothing on the record/.test(m.content));

test("room_status counts what each seat put on the record", () => {
  const { hub, a, b, c } = room4();
  hub.setBoard(ROOM, a.id, "claim/x", JSON.stringify({ owner: "A", area: "x" }));
  hub.setBoard(ROOM, a.id, "evidence/x", "measured 3 rooms");
  hub.setBoard(ROOM, a.id, "ideas/x", "one idea");
  hub.setBoard(ROOM, b.id, "claim/y", JSON.stringify({ owner: "B", area: "y" }));
  const pr = hub.propose(ROOM, a.id, "Adopt x as measured in evidence/x.");
  hub.challenge(ROOM, c.id, pr.id, 'The claim "Adopt x as measured" rests on three rooms only.');
  assert.deepEqual({ ...row(hub, "A").output, age_seconds: 0 }, { claims: 1, evidence: 2, verifies: 0, proposals: 1, challenges: 0, age_seconds: 0 });
  assert.deepEqual(row(hub, "B").output, { claims: 1, evidence: 0, verifies: 0, proposals: 0, challenges: 0, age_seconds: null }, "a claim alone is not output");
  assert.equal(row(hub, "C").output.challenges, 1);
  assert.equal(row(hub, "D").output.age_seconds, null);
});

test("a worker past the window with nothing on the record, while most others have something, is listed and told once", () => {
  const { hub, a, b, c } = room4();
  for (const p of [a, b, c]) hub.setBoard(ROOM, p.id, `evidence/${p.name}`, "findings");
  assert.deepEqual(listed(hub), [], "not listed before the window has passed");
  warnNoOutput(hub, hub.getRoom(ROOM));
  assert.equal(warnings(hub, "D").length, 0);
  age(hub);
  assert.deepEqual(listed(hub), ["D"]);
  warnNoOutput(hub, hub.getRoom(ROOM));
  warnNoOutput(hub, hub.getRoom(ROOM));
  assert.equal(warnings(hub, "D").length, 1, "told exactly once");
  assert.match(warnings(hub, "D")[0].content, /leave_room/);
  hub.setBoard(ROOM, hub.getRoom(ROOM).participants.get([...hub.getRoom(ROOM).participants.values()].find((p) => p.name === "D")!.id)!.id, "evidence/D", "late findings");
  assert.deepEqual(listed(hub), [], "one entry clears it");
});

test("a claim buys time, not immunity: a claim holder is listed only after the longer window, and told its branch is invisible", () => {
  const { hub, a, b, c, d } = room4();
  for (const p of [a, b, c]) hub.setBoard(ROOM, p.id, `evidence/${p.name}`, "findings");
  hub.setBoard(ROOM, d.id, "claim/build", JSON.stringify({ owner: "D", area: "build" }));
  age(hub);
  assert.deepEqual(listed(hub), [], "a builder with a claim is not listed at the short window");
  age(hub, NO_OUTPUT_CLAIMED_MS);
  assert.deepEqual(listed(hub), ["D"]);
  warnNoOutput(hub, hub.getRoom(ROOM));
  assert.match(warnings(hub, "D")[0].content, /you hold 1 claim\. Work on your branch is invisible here/);
});

test("still nothing one window after the warning: the hub opens the vote itself, casts no ballot, and withdraws it when the seat delivers", () => {
  const { hub, room, a, b, c, d } = room4();
  for (const p of [a, b, c]) hub.setBoard(ROOM, p.id, `evidence/${p.name}`, "findings");
  age(hub);
  warnNoOutput(hub, room);
  warnNoOutput(hub, room);
  assert.equal(room.kickVotes.size, 0, "no vote inside the grace window");
  const warned = warnings(hub, "D")[0];
  warned.ts = new Date(Date.now() - NO_OUTPUT_MS - 1000).toISOString();
  warnNoOutput(hub, room);
  warnNoOutput(hub, room);
  const kv = room.kickVotes.get(d.id)!;
  assert.equal(kv.status, "open");
  assert.equal(kv.by.name, "the hub");
  assert.deepEqual(kv.ballots, {}, "the hub casts no ballot");
  const lines = room.messages.filter((m) => m.kind === "system" && /the hub opened a vote on closing D's seat/.test(m.content));
  assert.equal(lines.length, 1, "opened once");
  assert.match(lines[0].content, /Routine check.*Hub record for D: 0 claims, 0 evidence entries/);
  hub.kickVote(ROOM, a.id, "D", "kick");
  assert.equal(room.participants.get(d.id)!.active, true, "one ballot never removes");
  hub.setBoard(ROOM, d.id, "evidence/D", "late findings");
  warnNoOutput(hub, room);
  assert.equal(kv.status, "dropped");
  assert.match(kv.outcome ?? "", /put something on the record/);
  assert.equal(room.participants.get(d.id)!.active, true);
});

test("a hub-opened vote removes the seat on the room's threshold, and a seat-opened vote is never withdrawn by the hub", () => {
  const { hub, room, a, b, c, d } = room4();
  for (const p of [a, b, c]) hub.setBoard(ROOM, p.id, `evidence/${p.name}`, "findings");
  age(hub);
  warnNoOutput(hub, room);
  warnings(hub, "D")[0].ts = new Date(Date.now() - NO_OUTPUT_MS - 1000).toISOString();
  warnNoOutput(hub, room);
  for (const p of [a, b, c]) hub.kickVote(ROOM, p.id, "D", "kick");
  assert.equal(room.participants.get(d.id)!.active, false);
  assert.ok(room.messages.some((m) => m.kind === "system" && /D was removed from the room by a kick vote started by the hub/.test(m.content)));
  const kv = hub.kickVote(ROOM, a.id, "B", "kick", "persistent disagreement blocking progress");
  warnNoOutput(hub, room);
  assert.equal(kv.status, "open");
});

test("no listing where the room does not work on the record, nor for verifier, chair or human", () => {
  const { hub, a } = room4();
  age(hub);
  hub.setBoard(ROOM, a.id, "evidence/A", "findings");
  assert.deepEqual(listed(hub), [], "one of four with output is not most of the room");
  const h2 = new Hub({});
  const o = { requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 5 };
  const w = ["A", "B", "C"].map((n, i) => h2.join(ROOM, n, "test", i ? {} : o, undefined, `s${i}`).participant);
  h2.join(ROOM, "verifier", "test", {}, undefined, "sv", "verifier");
  h2.join(ROOM, "benji", "human", {}, undefined, "http:benji");
  h2.join(ROOM, "D", "test", {}, undefined, "s9");
  for (const p of w) h2.setBoard(ROOM, p.id, `evidence/${p.name}`, "findings");
  age(h2);
  assert.deepEqual(listed(h2), ["D"]);
});

test("a kick vote announcement quotes the target's record, and the reason hint names no output", () => {
  const { hub, room, a, b } = room4();
  hub.setBoard(ROOM, a.id, "claim/x", "{}");
  assert.throws(() => hub.kickVote(ROOM, a.id, "D", "kick", "short"), /nothing on the record/);
  hub.setBoard(ROOM, [...room.participants.values()].find((p) => p.name === "D")!.id, "claim/z", "{}");
  hub.kickVote(ROOM, b.id, "D", "kick", "no output in 20 min per room_status no_output");
  const line = room.messages.find((m) => m.kind === "system" && /started a vote to kick D/.test(m.content))!.content;
  assert.match(line, /Hub record for D: 1 claim, 0 evidence entries, 0 verifies, 0 proposals, 0 challenges, 0 chat messages, \d+ min in the room/);
});

test("the record is derived from room state, so it survives a replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "seat-output-"));
  try {
    const { hub, a, b, c } = room4(dir);
    for (const p of [a, b, c]) hub.setBoard(ROOM, p.id, `evidence/${p.name}`, "findings");
    age(hub);
    warnNoOutput(hub, hub.getRoom(ROOM));
    const again = new Hub({ dataDir: dir });
    assert.equal(row(again, "A").output.evidence, 1);
    warnNoOutput(again, again.getRoom(ROOM));
    assert.equal(warnings(again, "D").length, 1, "a restart does not warn a second time");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
