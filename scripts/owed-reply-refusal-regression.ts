/** Pool item 1 (swarm-105804): a send refused over an already-shown ask says the reply is owed, not "arrived while composing". Run: npx tsx scripts/owed-reply-refusal-regression.ts */
import assert from "node:assert/strict";
import { Hub, HubError } from "../src/hub.js";

const hub = new Hub();
const name = "owed-reply-refusal";
const { participant: asker } = hub.join(name, "asker", "test");
const { participant: seat } = hub.join(name, "seat", "test");
const { participant: other } = hub.join(name, "other", "test");
const next = (p: typeof seat) => hub.wait(name, p.id, p.lastSeenSeq, 0);
for (const p of [asker, seat, other]) await next(p);

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof HubError, `expected a HubError, got ${e}`);
    return e as HubError & { data?: Record<string, unknown> };
  }
  assert.fail("send was not refused");
};

// A genuinely new message is still "arrived while composing".
hub.send(name, other.id, "an unrelated update", undefined, true);
const fresh = refusal(() => hub.send(name, seat.id, "my point"));
assert.match(fresh.message, /1 message\(s\) arrived while you were composing/);

// The ask is shown; the seat then tries to talk past it.
const ask = hub.send(name, asker.id, "@seat which file holds the cap?", undefined, true);
assert.ok((await next(seat)).some((m) => m.id === ask.id), "the ask is delivered");
const owed = refusal(() => hub.send(name, seat.id, "an unrelated point"));
assert.doesNotMatch(owed.message, /arrived while you were composing/, "nothing arrived: the seat owes a reply");
assert.match(owed.message, new RegExp(`still owe a reply to #${ask.seq}\\b`));
assert.match(owed.message, /0 other message\(s\) queued/);
assert.match(owed.message, new RegExp(`latest seq is #${ask.seq}\\b`));
assert.equal(owed.data?.owed_seq, ask.seq);
assert.equal(owed.data?.queued, 0);
assert.equal(owed.data?.latest_seq, ask.seq);

// More traffic lands behind the owed ask: the count and latest seq say how stale the seat's view is.
hub.send(name, other.id, "first news", undefined, true);
const last = hub.send(name, other.id, "second news", undefined, true);
const stale = refusal(() => hub.send(name, seat.id, "still unrelated"));
assert.match(stale.message, new RegExp(`still owe a reply to #${ask.seq}\\b`));
assert.match(stale.message, /2 other message\(s\) queued/);
assert.match(stale.message, new RegExp(`latest seq is #${last.seq}\\b`));
assert.equal(stale.data?.queued, 2);
assert.equal(stale.data?.latest_seq, last.seq);

// Replying settles it.
hub.send(name, seat.id, "src/hub.ts", ask.id);
console.log("OWED REPLY REFUSAL OK");
