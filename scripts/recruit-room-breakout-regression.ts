/**
 * Regression: a room opened by request_agent(new_room) is a breakout of the requester's room.
 * Run: npx tsx scripts/recruit-room-breakout-regression.ts
 *
 * Gap (swarm-003601-tky5, findings/hub-today E): join_room(parent=...) linked the child to its parent, so the parent's
 * room_status listed it and its conclusion landed as inbox/<child>/conclusion. request_agent(new_room=...) created the
 * room with no parent: absent from the parent's breakouts, and its conclusion reached the parent only if a recruit
 * remembered the prompt's post_to_room. The sub-team's own brief promised inbox/<child>/conclusion all the same.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";
import { Spawner } from "../src/spawner.js";

const LOBBY = "swarm-000002-rbrk-room";
const CHILD = "swarm-000002-rbrk-break";
const brief = "Try to break the liquidity-rewards lead; done when the room adopts a conclusion.";

function lobby() {
  const hub = new Hub({});
  const a = hub.join(LOBBY, "A", "test", { requireChallenge: false, quorum: "majority" }, undefined, "s1").participant;
  hub.join(LOBBY, "B", "test", {}, undefined, "s2");
  return { hub, a };
}

test("request_agent(new_room) hands the requester's room to ensureRoom as the parent", () => {
  const dir = mkdtempSync(join(tmpdir(), "recruit-room-breakout-"));
  try {
    const s = new Spawner({ logDir: dir, dryRun: true, mcpUrl: "http://127.0.0.1:0/mcp", defaultCwd: dir });
    const ensured: (string | undefined)[][] = [];
    s.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: (room, _topic, parent) => { ensured.push([room, parent]); }, announce: () => {}, liveAgents: () => 0 });
    const [rec] = s.request({ room: LOBBY, requestedBy: "A", brief, newRoom: CHILD, count: 1, name: "probe" });
    assert.deepEqual(ensured, [[CHILD, LOBBY]]);
    const prompt = readFileSync(rec.log, "utf8");
    assert.match(prompt, new RegExp(`inbox/${CHILD}/conclusion`), "the recruit is told where the conclusion lands");
    assert.doesNotMatch(prompt, /post the conclusion to the parent room/, "and is not asked to carry it by hand as well");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a recruit room is listed in its parent's breakouts and its conclusion is carried back", () => {
  const { hub } = lobby();
  hub.recruitRoom(CHILD, "break the lead", LOBBY);
  const child = hub.getRoom(CHILD);
  assert.equal(child.parent, LOBBY);
  assert.equal(child.requireVerification, true, "swarm defaults are kept");
  const x = hub.join(CHILD, "X", "test", {}, undefined, "s3").participant;
  const y = hub.join(CHILD, "Y", "test", {}, undefined, "s4").participant;
  assert.deepEqual((hub.summary(hub.getRoom(LOBBY)) as { breakouts?: { room: string }[] }).breakouts?.map((b) => b.room), [CHILD]);
  // recruits never join the parent: its electorate is still the two connections that were there
  assert.equal(hub.activeParticipants(hub.getRoom(LOBBY)).length, 2);
  child.requireVerification = false; child.requireChallenge = false;
  const pr = hub.propose(CHILD, x.id, "Adverse fills eat the reward below $750.");
  hub.vote(CHILD, y.id, pr.id, "agree", undefined, undefined, "Adverse fills eat the reward");
  assert.equal(child.state, "concluded");
  const entry = hub.getRoom(LOBBY).board.get(`inbox/${CHILD}/conclusion`);
  assert.ok(entry, "conclusion carried back without post_to_room");
  assert.match(entry.text, /Adverse fills eat the reward below \$750\./);
});

test("an existing room is never re-parented, and a parent that cannot take a conclusion is not linked", () => {
  const { hub } = lobby();
  hub.join("swarm-000002-rbrk-build", "X", "test", {}, undefined, "s3");
  hub.recruitRoom("swarm-000002-rbrk-build", "ignored", LOBBY); // recruiting into a room that already exists
  assert.equal(hub.getRoom("swarm-000002-rbrk-build").parent, undefined);
  hub.recruitRoom("swarm-000002-rbrk-orphan", "t", "no-such-room");
  assert.equal(hub.getRoom("swarm-000002-rbrk-orphan").parent, undefined);
  hub.recruitRoom("swarm-000002-rbrk-self", "t", "swarm-000002-rbrk-self");
  assert.equal(hub.getRoom("swarm-000002-rbrk-self").parent, undefined);
});
