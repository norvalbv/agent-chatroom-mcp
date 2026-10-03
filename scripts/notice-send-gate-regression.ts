/**
 * swarm-181144-uxtr issue 1: hub notices are news, not debt (hub-carries-what-it-knows, 2026-09-23), but the
 * stale-send guard still counted them. A [BOARD] line or a hub-authored @-notice (reviewer assignment) that landed
 * after a seat's last read refused its send_message with "N message(s) arrived while you were composing", and the
 * seat paid a refused call plus a forced retry. scripts/refused-send-split.py found 13 of 140 arrived-refusals across
 * four real runs whose only unread lines were such notices. Now only a peer's (or human's) message blocks a send;
 * the notices still reach the seat's next wait, unconsumed.
 * Run: npx tsx scripts/notice-send-gate-regression.ts
 */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

let serial = 0;
function setup() {
  const h = new Hub();
  const name = `notice-gate-${++serial}`;
  const { room, participant: alice } = h.join(name, "alice", "test");
  const { participant: bob } = h.join(name, "bob", "test");
  const { participant: carol } = h.join(name, "carol", "test");
  return { h, room, alice, bob, carol };
}

test("a board notice that arrived after the last read does not refuse a send, and the next wait still delivers it", async () => {
  const { h, room, alice, bob } = setup();
  await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
  h.setBoard(room.name, alice.id, "evidence/x", "numbers");
  assert.doesNotThrow(() => h.send(room.name, bob.id, "bob: starting on y"));
  const next = await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
  assert.ok(next.some((m) => m.kind === "board" && /evidence\/x/.test(m.content)), `notice still delivered; got ${JSON.stringify(next.map((m) => m.content))}`);
});

test("a hub-authored @-notice (reviewer assignment) does not refuse the reviewer's send", async () => {
  const { h, room, alice, bob } = setup();
  await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
  await h.wait(room.name, alice.id, alice.lastSeenSeq, 0);
  const entry = h.setBoard(room.name, alice.id, "claim/z", JSON.stringify({ area: "z", owner: "alice", status: "open" }))!;
  const reviewer = [...room.participants.values()].find((p) => p.name === entry.reviewer)!;
  assert.ok(room.messages.some((m) => m.from.id === "system" && m.kind === "chat" && m.mentions?.includes(reviewer.id)), "the hub posted a reviewer notice");
  assert.doesNotThrow(() => h.send(room.name, reviewer.id, `${reviewer.name}: noted`));
  const next = await h.wait(room.name, reviewer.id, reviewer.lastSeenSeq, 0);
  assert.ok(next.some((m) => /you are the reviewer/.test(m.content)), `the reviewer notice still reaches the next wait; got ${JSON.stringify(next.map((m) => m.content))}`);
  const after = await h.wait(room.name, reviewer.id, reviewer.lastSeenSeq, 0);
  assert.ok(!after.some((m) => /you are the reviewer/.test(m.content)), "and only once");
});

test("a peer's chat message still refuses a stale send (the guard is unchanged for real messages)", async () => {
  const { h, room, bob, carol } = setup();
  await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
  h.send(room.name, carol.id, "carol: I already fixed y", undefined, true);
  assert.throws(() => h.send(room.name, bob.id, "bob: starting on y"), /arrived while you were composing/);
});

test("a notice plus a peer message: refused, and the refusal lists the peer message", async () => {
  const { h, room, alice, bob, carol } = setup();
  await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
  h.setBoard(room.name, alice.id, "evidence/w", "numbers");
  h.send(room.name, carol.id, "carol: w is done", undefined, true);
  assert.throws(() => h.send(room.name, bob.id, "bob: starting on w"), /1 message\(s\) arrived while you were composing/);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
if (failed) {
  console.log(`NOTICE SEND GATE: ${failed} failed`);
  process.exit(1);
}
console.log(`NOTICE SEND GATE OK (${cases.length}/${cases.length})`);
