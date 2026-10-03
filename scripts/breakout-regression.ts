/**
 * Breakout regressions (swarm-202803-dpij, claim/breakouts). Run: npx tsx scripts/breakout-regression.ts
 *
 * A breakout is join_room(room=<new>, parent=<a room you are in>): the child is linked to the parent, the parent is told
 * once, the opener keeps its parent seat, the child's conclusion lands on the parent's board as inbox/<child>/conclusion
 * without anyone calling post_to_room, and Hub.elsewhere tells a connection what it owes in its other rooms (the server's
 * wait wakes on it). Electorates are untouched: a breakout adds no voter to the parent.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

const PARENT = "swarm-000001-brko-room";
const CHILD = "swarm-000001-brko-steer";

function room(dataDir?: string) {
  const hub = new Hub({ dataDir });
  const opts = { requireChallenge: false, nudgeAfterMs: 0, quorum: "majority" as const };
  const a = hub.join(PARENT, "A", "test", opts, undefined, "s1").participant;
  const b = hub.join(PARENT, "B", "test", {}, undefined, "s2").participant;
  const c = hub.join(PARENT, "C", "test", {}, undefined, "s3").participant;
  return { hub, a, b, c };
}

test("only an active member of the parent opens a breakout; it is linked and announced once", () => {
  const { hub } = room();
  assert.throws(() => hub.join(CHILD, "X", "test", { parent: PARENT }, undefined, "stranger"), /Only an active member/);
  assert.throws(() => hub.join(CHILD, "A", "test", { parent: "nope" }, undefined, "s1"), /does not exist/);
  assert.equal(hub.rooms.has(CHILD), false, "a refused breakout creates no room");
  const before = hub.getRoom(PARENT).messages.length;
  hub.join(CHILD, "A", "test", { parent: PARENT, topic: "steering contract" }, undefined, "s1");
  const child = hub.getRoom(CHILD);
  assert.equal(child.parent, PARENT);
  const notes = hub.getRoom(PARENT).messages.slice(before).filter((m) => m.content.includes(`opened breakout room ${CHILD}`));
  assert.equal(notes.length, 1);
  assert.match(notes[0].content, new RegExp(`inbox/${CHILD}/conclusion`));
  hub.join(CHILD, "B", "test", {}, undefined, "s2"); // a plain join of an existing breakout needs no parent
  assert.throws(() => hub.join(CHILD, "C", "test", { parent: "other" }, undefined, "s3"), /never re-parented/);
  const summary = hub.summary(hub.getRoom(PARENT)) as { breakouts?: { room: string; members: string[] }[] };
  assert.deepEqual(summary.breakouts?.map((x) => [x.room, x.members.sort()]), [[CHILD, ["A", "B"]]]);
  assert.equal((hub.summary(child) as { parent?: string }).parent, PARENT);
  // the opener kept its parent seat; the parent's electorate is still the three connections
  assert.equal(hub.activeParticipants(hub.getRoom(PARENT)).length, 3);
});

test("a concluded breakout's decision lands on the parent's board without post_to_room", () => {
  const { hub } = room();
  const a = hub.join(CHILD, "A", "test", { parent: PARENT, requireChallenge: false, quorum: "majority" }, undefined, "s1").participant;
  const b = hub.join(CHILD, "B", "test", {}, undefined, "s2").participant;
  const pr = hub.propose(CHILD, a.id, "Inject asks via the PreToolUse hook.");
  hub.vote(CHILD, b.id, pr.id, "agree", undefined, undefined, "via the PreToolUse hook");
  assert.equal(hub.getRoom(CHILD).state, "concluded");
  const entry = hub.getRoom(PARENT).board.get(`inbox/${CHILD}/conclusion`);
  assert.ok(entry, "conclusion carried back");
  assert.match(entry!.text, /Inject asks via the PreToolUse hook/);
  assert.ok(hub.getRoom(PARENT).messages.some((m) => m.content.includes(`breakout ${CHILD} concluded`)));
});

test("elsewhere: a seat working in the breakout learns what it owes in the parent, and nothing else", () => {
  const { hub, a, b } = room();
  hub.join(CHILD, "A", "test", { parent: PARENT }, undefined, "s1");
  assert.deepEqual(hub.elsewhere("s1", CHILD), []);
  assert.equal(hub.sessionRoomCount("s1"), 2);
  assert.equal(hub.sessionRoomCount("s3"), 1);
  hub.send(PARENT, b.id, "@A can you check the hook contract?");
  assert.deepEqual(hub.elsewhere("s1", CHILD), [{ room: PARENT, addressed: 1 }]);
  const pr = hub.propose(PARENT, b.id, "Land the hook.");
  const owed = hub.elsewhere("s1", CHILD)[0];
  assert.equal(owed.vote_owed, pr.id);
  assert.deepEqual(hub.elsewhere("s3", PARENT), [], "a seat in one room owes nothing elsewhere");
  void a;
});

test("the parent link survives a hub restart (replay), and the carried conclusion is not written twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "breakout-"));
  try {
    const { hub } = room(dir);
    const a = hub.join(CHILD, "A", "test", { parent: PARENT, requireChallenge: false, quorum: "majority" }, undefined, "s1").participant;
    const b = hub.join(CHILD, "B", "test", {}, undefined, "s2").participant;
    const pr = hub.propose(CHILD, a.id, "Decide the breakout question X now.");
    hub.vote(CHILD, b.id, pr.id, "agree", undefined, undefined, "Decide the breakout question");
    const replayed = new Hub({ dataDir: dir });
    assert.equal(replayed.getRoom(CHILD).parent, PARENT);
    assert.ok(replayed.getRoom(PARENT).board.get(`inbox/${CHILD}/conclusion`));
    const carried = replayed.getRoom(PARENT).messages.filter((m) => m.content.includes(`breakout ${CHILD} concluded`));
    assert.equal(carried.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a parent that already concluded is not written to; a long conclusion is cut with a pointer, objections kept", () => {
  const { hub, a, b } = room();
  const ca = hub.join(CHILD, "A", "test", { parent: PARENT, requireChallenge: false, quorum: "majority" }, undefined, "s1").participant;
  const cb = hub.join(CHILD, "B", "test", {}, undefined, "s2").participant;
  const pp = hub.propose(PARENT, a.id, "The parent decides first, before the breakout.");
  hub.vote(PARENT, b.id, pp.id, "agree", undefined, undefined, "The parent decides first");
  assert.equal(hub.getRoom(PARENT).state, "concluded");
  const pr = hub.propose(CHILD, ca.id, "The late breakout decision arrives after its parent.");
  hub.vote(CHILD, cb.id, pr.id, "agree", undefined, undefined, "The late breakout decision");
  assert.equal(hub.getRoom(PARENT).board.has(`inbox/${CHILD}/conclusion`), false, "a concluded parent's board is final");

  const second = room();
  const x = second.hub.join(CHILD, "A", "test", { parent: PARENT, requireChallenge: false, quorum: "majority" }, undefined, "s1").participant;
  const y = second.hub.join(CHILD, "B", "test", {}, undefined, "s2").participant;
  const long = `Keep the opening clause here. ${"filler ".repeat(1400)}DECISIVE SUFFIX`;
  const lp = second.hub.propose(CHILD, x.id, long);
  second.hub.vote(CHILD, y.id, lp.id, "agree", undefined, undefined, "Keep the opening clause here.");
  const entry = second.hub.getRoom(PARENT).board.get(`inbox/${CHILD}/conclusion`)!;
  assert.ok(entry.text.length <= 8000);
  assert.ok(entry.text.split("\n")[0].includes(`whole text: room_status room="${CHILD}"`), "the pointer leads the entry");
  assert.match(entry.text, /\[cut at the board cap: \d+ chars in all/);
  assert.doesNotMatch(entry.text, /DECISIVE SUFFIX/);

  // an objection longer than the cap cannot push the pointer out either
  const third = room();
  const p1 = third.hub.join(CHILD, "A", "test", { parent: PARENT, requireChallenge: false, quorum: "majority" }, undefined, "s1").participant;
  const p2 = third.hub.join(CHILD, "B", "test", {}, undefined, "s2").participant;
  const pz = third.hub.propose(CHILD, p1.id, "Short decision that carries a long objection with it.");
  third.hub.challenge(CHILD, p2.id, pz.id, `"Short decision" ${"objection ".repeat(1000)}`, false);
  third.hub.vote(CHILD, p2.id, pz.id, "agree", undefined, undefined, "Short decision that carries");
  const e3 = third.hub.getRoom(PARENT).board.get(`inbox/${CHILD}/conclusion`)!;
  assert.ok(e3.text.length <= 8000);
  assert.ok(e3.text.split("\n")[0].includes(`whole text: room_status room="${CHILD}"`));

  // a 64-char child name (the room-name cap) still fits the cap, marker included
  const longName = `swarm-202803-dpij-${"b".repeat(46)}`;
  const fourth = room();
  const l1 = fourth.hub.join(longName, "A", "test", { parent: PARENT, requireChallenge: false, quorum: "majority" }, undefined, "s1").participant;
  const l2 = fourth.hub.join(longName, "B", "test", {}, undefined, "s2").participant;
  const lp2 = fourth.hub.propose(longName, l1.id, long);
  fourth.hub.vote(longName, l2.id, lp2.id, "agree", undefined, undefined, "Keep the opening clause here.");
  const e4 = fourth.hub.getRoom(PARENT).board.get(`inbox/${longName}/conclusion`)!;
  assert.ok(e4.text.length <= 8000, `${e4.text.length} chars`);
  assert.ok(e4.text.endsWith(`room_status room="${longName}"]`));
});

test("server: a seat holding a wait in its breakout wakes when it is addressed in the parent, and is told where", async () => {
  const hub = new Hub();
  const connect = async () => {
    const session = createSessionServer(hub);
    const client = new Client({ name: "t", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await session.server.connect(st);
    await client.connect(ct);
    return async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(!r.isError, JSON.stringify(r));
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
  };
  const asA = await connect();
  const asB = await connect();
  await asA("join_room", { room: PARENT, name: "A", agent: "test" });
  await asB("join_room", { room: PARENT, name: "B", agent: "test" });
  const opened = await asA("join_room", { room: CHILD, name: "A", agent: "test", parent: PARENT, topic: "side question" });
  assert.equal(opened.room.parent, PARENT);
  await asA("wait_for_messages", { room: CHILD, timeout_ms: 0 });
  const started = Date.now();
  const waiting = asA("wait_for_messages", { room: CHILD, timeout_ms: 30_000, hold_until_actionable: true });
  setTimeout(() => void asB("send_message", { room: PARENT, content: "@A quick question about the parent plan" }), 300);
  const woke = await waiting;
  const took = Date.now() - started;
  assert.ok(took < 12_000, `woke after ${took} ms, not at the 30 s deadline`);
  assert.deepEqual(woke.other_rooms, [{ room: PARENT, addressed: 1 }]);
});
