/**
 * The conclusion carries who agreed with nothing on the record and which claims were never delivered
 * (claim/conclusion-output, swarm-000525-jcz8). Run: npx tsx scripts/conclusion-output-regression.ts
 *
 * Covers: a worker that voted agree with no evidence, verify, proposal or challenge is named in the conclusion, in its
 * system line and in room_status; a claim/* whose owner put no evidence or verify on the board is listed with its owner;
 * a released claim and a claim with a handoff/<area> are not; the verifier and humans are never named; a room where
 * everyone delivered gets neither clause; nothing is refused; both lists survive a replay.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const ROOM = "conclusion-output-regression";
/** The first propose in a room is refused once while a present seat holds a bare claim (R3, CLAIMS WITHOUT FINDINGS); these
 * cases are about what the record says at the conclusion, so they go ahead the way the refusal says: propose again. */
const BARE_CLAIM_REFUSAL = /CLAIMS WITHOUT FINDINGS/;
function proposeThrough(hub: Hub, room: string, pid: string, text: string) {
  try { return hub.propose(room, pid, text); } catch (e) {
    if (!BARE_CLAIM_REFUSAL.test(String((e as Error).message))) throw e;
    return hub.propose(room, pid, text);
  }
}

const TEXT = "Adopt x as measured in evidence/x.";
type Carried = { agreed_without_output?: string[]; undelivered_claims?: { key: string; by: string }[] };

function room4(dataDir?: string) {
  const hub = new Hub({ dataDir });
  const opts = { requireChallenge: false, nudgeAfterMs: 0, quorum: "supermajority" as const, expectedParticipants: 4 };
  const a = hub.join(ROOM, "A", "test", opts, undefined, "s1").participant;
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const c = hub.join(ROOM, "C", "test", {}, undefined, "s3").participant;
  const d = hub.join(ROOM, "D", "test", {}, undefined, "s4").participant;
  return { hub, room: hub.getRoom(ROOM), a, b, c, d };
}
const agree = (hub: Hub, pid: string, prId: string) => hub.vote(ROOM, pid, prId, "agree", undefined, undefined, "Adopt x as measured");
const carried = (hub: Hub) => (hub.summary(hub.getRoom(ROOM)) as unknown as { conclusion: Carried | null }).conclusion!;
const line = (hub: Hub) => hub.getRoom(ROOM).messages.find((m) => m.kind === "conclusion")!.content;

/** A measured and proposed; B claimed and delivered nothing; D did nothing at all; B and D carry the vote. */
function thinRoom(dataDir?: string) {
  const r = room4(dataDir);
  r.hub.setBoard(ROOM, r.a.id, "claim/x", JSON.stringify({ owner: "A", area: "x" }));
  r.hub.setBoard(ROOM, r.a.id, "evidence/x", "measured three rooms: two had an idle seat, one did not");
  r.hub.setBoard(ROOM, r.b.id, "claim/y", JSON.stringify({ owner: "B", area: "y" }));
  const pr = proposeThrough(r.hub, ROOM, r.a.id, TEXT);
  agree(r.hub, r.b.id, pr.id);
  agree(r.hub, r.d.id, pr.id);
  return r;
}

test("the conclusion names seats that agreed with nothing on the record, and claims nobody delivered under", () => {
  const { hub, room } = thinRoom();
  assert.equal(room.state, "concluded", "not a gate: the room concludes as before");
  assert.deepEqual(carried(hub).agreed_without_output, ["B", "D"]);
  assert.deepEqual(carried(hub).undelivered_claims, [{ key: "claim/y", by: "B" }], "A delivered under claim/x; a claim alone is not output");
  assert.match(line(hub), /^CONSENSUS REACHED on /);
  assert.match(line(hub), /\nAgreed with nothing on the record: B, D(\n|$)/);
  assert.match(line(hub), /\nClaimed, nothing delivered: claim\/y \(B\)(\n|$)/);
});

test("a room where every voter and every claimant delivered gets neither clause", () => {
  const { hub, room, a, b, c } = room4();
  hub.setBoard(ROOM, a.id, "claim/x", JSON.stringify({ owner: "A", area: "x" }));
  for (const p of [a, b]) hub.setBoard(ROOM, p.id, `evidence/${p.name}`, "findings: measured three rooms, two had an idle seat");
  const pr = proposeThrough(hub, ROOM, a.id, TEXT);
  hub.challenge(ROOM, c.id, pr.id, 'The claim "Adopt x as measured" rests on three rooms only.', false);
  agree(hub, b.id, pr.id);
  agree(hub, c.id, pr.id);
  assert.equal(room.state, "concluded");
  assert.deepEqual(carried(hub).agreed_without_output, [], "a challenge is output");
  assert.deepEqual(carried(hub).undelivered_claims, []);
  assert.doesNotMatch(line(hub), /nothing on the record|nothing delivered/);
});

test("a released claim and a claim with a handoff are not listed, and the verifier and humans are never named", () => {
  const hub = new Hub({});
  const opts = { requireChallenge: false, nudgeAfterMs: 0, quorum: "supermajority" as const, expectedParticipants: 4 };
  const a = hub.join(ROOM, "A", "test", opts, undefined, "s1").participant;
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const c = hub.join(ROOM, "C", "test", {}, undefined, "s3").participant;
  const v = hub.join(ROOM, "verifier", "test", {}, undefined, "sv", "verifier").participant;
  const h = hub.join(ROOM, "benji", "human", {}, undefined, "http:benji").participant;
  const room = hub.getRoom(ROOM);
  hub.setBoard(ROOM, a.id, "evidence/x", "measured three rooms: two had an idle seat, one did not");
  hub.setBoard(ROOM, b.id, "claim/y", JSON.stringify({ owner: "B", area: "y" }));
  hub.setBoard(ROOM, c.id, "claim/z", JSON.stringify({ owner: "C", area: "z" }));
  hub.setBoard(ROOM, a.id, "handoff/y", "A took y over: nothing was started");
  room.board.set("claim/gone", { text: JSON.stringify({ status: "released", previous_owner: "E" }), by: "system", updatedAt: new Date().toISOString() });
  const pr = proposeThrough(hub, ROOM, a.id, TEXT);
  for (const p of [v, h, b, c]) if (room.state !== "concluded") agree(hub, p.id, pr.id);
  assert.equal(room.state, "concluded");
  const names = carried(hub).agreed_without_output!;
  assert.ok(!names.includes("verifier") && !names.includes("benji"), `verifier and human are not measured by the record: ${names}`);
  assert.ok(names.length > 0 && names.every((n) => n === "B" || n === "C"));
  assert.deepEqual(carried(hub).undelivered_claims, [{ key: "claim/z", by: "C" }]);
});

test("both lists are part of the persisted conclusion, so they survive a replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "conclusion-output-"));
  try {
    thinRoom(dir);
    const again = new Hub({ dataDir: dir });
    assert.equal(again.getRoom(ROOM).state, "concluded");
    assert.deepEqual(carried(again).agreed_without_output, ["B", "D"]);
    assert.deepEqual(carried(again).undelivered_claims, [{ key: "claim/y", by: "B" }]);
    assert.match(line(again), /Agreed with nothing on the record: B, D/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
