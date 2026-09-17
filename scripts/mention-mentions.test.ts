/** Narrow mentionsIn regression. Run: npx tsx scripts/mention-mentions.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

function fixture(anonymous = false) {
  const hub = new Hub();
  const { room, participant: sender } = hub.join("mentions-regression", "sender", "test", { anonymous, expectedParticipants: 0 });
  const { participant: target } = hub.join(room.name, "union-alpha-28", "test");
  const { participant: observer } = hub.join(room.name, "observer", "test");
  return { hub, room, sender, target, observer };
}

for (const anonymous of [false, true]) {
  for (const text of [
    "@union-alpha-28 I have evidence",
    "@union-alpha-28 a test",
    "@union-alpha-28: I have evidence",
    "(@union-alpha-28), a test!",
    "@UNION-ALPHA-28 agrees",
    "@union-alpha-28",
    "@B I have evidence",
    "@B a test",
    "@Participant B I have evidence",
    "@participant b, a test",
    "@PARTICIPANT B I have evidence",
  ]) {
    test(`mention ${JSON.stringify(text)} anonymous=${anonymous}`, () => {
      const { hub, room, target } = fixture(anonymous);
      assert.deepEqual(hub.mentionsIn(room, text), [target.id]);
    });
  }
  for (const text of ["@unknown I have evidence", "@union-alpha-280 a test", "@union-alpha-28-extra", "@Participant Z", "@Participant B-extra", "unaddressed prose"]) {
    test(`unknown mention ${JSON.stringify(text)} anonymous=${anonymous}`, () => {
      const { hub, room } = fixture(anonymous);
      assert.deepEqual(hub.mentionsIn(room, text), []);
    });
  }
}

test("mentions are deduplicated while multiple recipients remain resolved", () => {
  const { hub, room, target, observer } = fixture();
  assert.deepEqual(hub.mentionsIn(room, "@union-alpha-28 I agree; @B: yes. @observer a test"), [target.id, observer.id]);
});

test("quiet mention routes pushes, remains pullable, and pass clears only a delivered ask", async () => {
  const { hub, room, sender, target, observer } = fixture();
  const message = hub.send(room.name, sender.id, "@union-alpha-28 I have evidence", undefined, true, true);
  assert.deepEqual(message.mentions, [target.id]);
  assert.deepEqual(new Set(message.audience), new Set([sender.id, target.id]));
  assert.equal(hub.pushableTo(room, message, target.id), true);
  assert.equal(hub.pushableTo(room, message, observer.id), false);
  assert.equal(hub.read(room.name, 0, 200, observer.id).some(m => m.id === message.id), true);
  assert.deepEqual(hub.addressedBy(room, target).map(m => m.id), [message.id]);
  assert.deepEqual(hub.addressedBy(room, observer), []);
  // Attention gate (swarm-200839): a bare pass before the ask has been delivered never declines it.
  hub.pass(room.name, target.id);
  assert.deepEqual(hub.addressedBy(room, target).map(m => m.id), [message.id]);
  // Delivery focuses the ask; a pass now declines exactly that ask.
  await hub.wait(room.name, target.id, target.lastSeenSeq, 0);
  hub.pass(room.name, target.id);
  assert.deepEqual(hub.addressedBy(room, target), []);
  assert.throws(() => hub.send(room.name, sender.id, "@unknown a test", undefined, true, true), /quiet/i);
});
