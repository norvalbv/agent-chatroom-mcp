/**
 * A hold whose author has left stops holding (evidence-pack item 1, follow-up to the last call). The LAST CALL line
 * tells a seat whose work needs longer than the window to write hold/<room>. A hold never expired and only its author
 * (or a human) could clear it, so a seat that held the room and then died (usage limit, crash: 18 seats lost in 2 runs,
 * pack item 9) would leave the proposal unable to pass for good. Now a hold counts only while its author is in the room
 * (active, or away: process alive / restored by a restart under 10 min ago) or is a human; when it lapses the room is
 * told once and anyone may clear or replace the key. Red on main: the room stays held after the author leaves.
 * Run: npx tsx scripts/hold-lapses-regression.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

test("a hold lapses when its author leaves, the room is told, and the proposal can pass", () => {
  Hub.LAST_CALL_MS = 0;
  const hub = new Hub();
  const opts = { nudgeAfterMs: 0, requireChallenge: false, quorum: "majority" as const };
  const a = hub.join("hl", "A", "test", opts, undefined, "s1").participant;
  const b = hub.join("hl", "B", "test", {}, undefined, "s2").participant;
  const c = hub.join("hl", "C", "test", {}, undefined, "s3").participant;
  const room = hub.getRoom("hl");
  hub.setBoard("hl", c.id, "hold/hl", "my rerun of the bench needs 20 more minutes");
  const pr = hub.propose("hl", a.id, "Adopt the cache keyed by repo root, not by path.");
  hub.vote("hl", b.id, pr.id, "agree", "checked", undefined, "keyed by repo root");
  assert.equal(room.state, "open", "held while C is in the room");
  hub.leave("hl", c.id, "seat process exited (exit 1, launcher receipt)");
  assert.equal(room.state, "concluded", "C left: its hold no longer holds the room");
  assert.ok(room.messages.some((m) => m.kind === "system" && /hold by C no longer holds/.test(m.content)), "the room is told why");
});

test("while the author is present the hold stands, and only they can clear it; once lapsed, anyone can", () => {
  Hub.LAST_CALL_MS = 0;
  const hub = new Hub();
  const a = hub.join("hl2", "A", "test", { nudgeAfterMs: 0 }, undefined, "s1").participant;
  const b = hub.join("hl2", "B", "test", {}, undefined, "s2").participant;
  hub.setBoard("hl2", a.id, "hold/hl2", "waiting for the scorer");
  assert.ok(hub.hold(hub.getRoom("hl2")), "A is here: the hold stands");
  assert.throws(() => hub.setBoard("hl2", b.id, "hold/hl2", ""), /only they \(or a human\)/);
  hub.leave("hl2", a.id, "done for today, nothing left");
  assert.equal(hub.hold(hub.getRoom("hl2")), undefined, "A left: no hold");
  // the abandoned key can be cleared by anyone now, as any peer entry: overwrite=true, after the board's one "you have not read it" refusal
  assert.throws(() => hub.setBoard("hl2", b.id, "hold/hl2", "", { overwrite: true }), /not read/);
  hub.setBoard("hl2", b.id, "hold/hl2", "", { overwrite: true });
  assert.equal(hub.getRoom("hl2").board.has("hold/hl2"), false);
});
