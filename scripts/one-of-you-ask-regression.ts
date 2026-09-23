/**
 * swarm-083203-kooz pool item 9: a "one of you" ask that @-names several seats stayed owed by every
 * named seat after one of them had answered, so the others kept seeing it as their focus and had
 * send_message refused until they passed. Once any named seat replies (reply_to the ask, or an
 * @-reply to its author), the ask is retired for every seat it named. A reply from a seat the ask
 * did not name retires nothing, and an ask naming only one seat is still owed by that seat alone.
 * Run: npx tsx scripts/one-of-you-ask-regression.ts
 */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

let serial = 0;
function room3() {
  const h = new Hub();
  const name = `one-of-you-${++serial}`;
  const { room, participant: asker } = h.join(name, "asker", "test");
  const { participant: bob } = h.join(name, "bob", "test");
  const { participant: carol } = h.join(name, "carol", "test");
  const { participant: dave } = h.join(name, "dave", "test");
  return { h, room, asker, bob, carol, dave };
}

const cases: [string, () => Promise<void>][] = [
  ["a reply_to from one named seat retires the ask for every named seat", async () => {
    const { h, room, asker, bob, carol } = room3();
    const ask = h.send(room.name, asker.id, "@bob @carol one of you please verify item 6", undefined, true);
    await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
    await h.wait(room.name, carol.id, carol.lastSeenSeq, 0);
    assert.equal(h.attentionFocus(room, carol)?.id, ask.id, "carol is asked");
    h.send(room.name, bob.id, "on it", ask.id);
    assert.equal(h.attentionFocus(room, bob), undefined, "bob answered");
    assert.equal(h.attentionFocus(room, carol), undefined, "bob's reply retires the ask for carol too");
    assert.equal(h.addressedBy(room, carol).length, 0);
    await h.wait(room.name, carol.id, carol.lastSeenSeq, 0);
    assert.doesNotThrow(() => h.send(room.name, carol.id, "carol: moving to item 9"), "carol is not refused for an ask bob answered");
  }],
  ["an @-reply to the asker from a named seat also retires it for the others", async () => {
    const { h, room, asker, bob, carol } = room3();
    h.send(room.name, asker.id, "@bob @carol which of you has the commit?", undefined, true);
    h.send(room.name, carol.id, "@asker it is d03d251", undefined, true);
    assert.equal(h.attentionFocus(room, bob), undefined);
  }],
  ["a reply from a seat the ask did not name retires nothing", async () => {
    const { h, room, asker, bob, carol, dave } = room3();
    const ask = h.send(room.name, asker.id, "@bob @carol one of you please verify", undefined, true);
    h.send(room.name, dave.id, "I can do it", ask.id, true);
    assert.equal(h.attentionFocus(room, bob)?.id, ask.id, "dave was not asked; bob still owes it");
    assert.equal(h.attentionFocus(room, carol)?.id, ask.id);
  }],
  ["an ask naming one seat is not retired by another seat's reply", async () => {
    const { h, room, asker, bob, carol } = room3();
    const ask = h.send(room.name, asker.id, "@bob please verify", undefined, true);
    h.send(room.name, carol.id, "I looked too", ask.id, true);
    assert.equal(h.attentionFocus(room, bob)?.id, ask.id);
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  try { await run(); console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}\n${(error as Error).stack}`); }
}
console.log(`ONE-OF-YOU ASK: ${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
