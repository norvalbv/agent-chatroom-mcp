/**
 * The room states its size limits, and a refusal for size says what was sent, what is allowed and what to do instead
 * (evidence-pack item 3, chat-and-friction issue 11). Limits were found only by being refused: 18 board_set size
 * refusals in 6 rooms said "capped at 8000 characters" with neither the size sent nor a way on, so ledgers were split
 * by hand into ledger-2..7; in 0btz-leads the two group conclusions (7,790 chars) were refused four times as chat with
 * "Say less: one claim, one reason, one ask", which is the wrong advice for a conclusion. join_room named only
 * opening_max_chars.
 * Run: npx tsx --test scripts/limits-stated-regression.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Hub } from "../src/hub.js";

function fixture(t: { after: (fn: () => void) => void }) {
  const hub = new Hub();
  const name = "limits-stated";
  const a = hub.join(name, "Alice", "claude", { nudgeAfterMs: 0 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "claude", {}, undefined, "session-b").participant;
  const room = hub.getRoom(name);
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  return { hub, room, a, b };
}

test("the room summary (what join_room returns; room_status leaves constants out) names every size limit a seat can hit", (t) => {
  const { hub, room } = fixture(t);
  assert.deepEqual((hub.summary(room) as { limits?: unknown }).limits, { message_chars: 4000, board_entry_chars: 8000, opening_chars: 400 });
});

test("a message over the limit is told its size, the limit, and to put the text on the board with a pointer", (t) => {
  const { hub, room, a } = fixture(t);
  const long = "The build group concludes that the table holds on 41 of 42 rows. ".repeat(120);
  assert.throws(() => hub.send(room.name, a.id, long, undefined, true), (e: Error) => {
    assert.match(e.message, new RegExp(`${long.length} chars; this room allows 4000 in chat`));
    assert.match(e.message, /board_set .*up to 8000.*one-line message naming the key/);
    return true;
  });
});

test("a board entry or note over the cap is told its size and how to carry on", (t) => {
  const { hub, room, a } = fixture(t);
  const big = "row | status | cost\n".repeat(500);
  assert.throws(() => hub.setBoard(room.name, a.id, "ledger", big), (e: Error) => {
    assert.match(e.message, new RegExp(`${big.length} chars; a board entry holds 8000`));
    assert.match(e.message, /split it across keys \(ledger-2, \.\.\.\)|append=true/);
    return true;
  });
  hub.join("other-room", "Alice", "claude", { nudgeAfterMs: 0 }, undefined, "session-a");
  const other = hub.getRoom("other-room");
  t.after(() => { clearTimeout(other.nudgeTimer); clearTimeout(other.openingsTimer); });
  const me = [...other.participants.values()][0];
  assert.throws(() => hub.postToRoom("other-room", me.id, room.name, "big-note", big), new RegExp(`${big.length} chars; a note holds 8000`));
});
