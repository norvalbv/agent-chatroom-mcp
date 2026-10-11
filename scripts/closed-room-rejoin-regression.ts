/**
 * Nobody is put back in a closed room by joining it by hand (idea/closed-room-rejoin-by-hand, from merge-review backlog
 * B9d). d37025d8 stopped a seat-key reseat from re-activating a seat in a closed room, but join_room with the seat's old
 * name or participant_id still did: active again, a join event in the log and "rejoined the room" posted in a room
 * nobody can act in. A closed room refuses the rejoin (typed "state"), and a new name, as before; a concluded room is
 * different (seats still read the conclusion there) and is unchanged. A human may still come back to read.
 * Run: npx tsx --test scripts/closed-room-rejoin-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub, HubError } from "../src/hub.js";

function closed(t: { after: (fn: () => void) => void }) {
  const dataDir = mkdtempSync(join(tmpdir(), "closed-rejoin-"));
  const hub = new Hub({ dataDir });
  const a = hub.join("cr", "A", "claude", { nudgeAfterMs: 0 }, undefined, "s1").participant;
  const b = hub.join("cr", "B", "claude", {}, undefined, "s2").participant;
  const room = hub.getRoom("cr");
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  hub.closeRoom("cr", "benji", "owner closed it");
  assert.equal(room.state, "closed");
  return { hub, room, a, b, dataDir };
}
const code = (fn: () => unknown) => { try { fn(); return "none"; } catch (e) { return e instanceof HubError ? e.code : "other"; } };

test("a closed room refuses a rejoin by participant_id or by name, and writes nothing", (t) => {
  const { hub, room, a, b, dataDir } = closed(t);
  const before = readFileSync(join(dataDir, "cr.jsonl"), "utf8").length;
  const lines = room.messages.length;
  assert.equal(code(() => hub.join("cr", "A", "claude", {}, a.id, "s1-new")), "state", "rejoin by participant_id");
  assert.equal(code(() => hub.join("cr", "B", "claude", {}, undefined, "s2-new")), "state", "rejoin by name");
  assert.equal(room.participants.get(a.id)!.active, false);
  assert.equal(room.participants.get(b.id)!.active, false);
  assert.equal(room.messages.length, lines, "no 'rejoined the room' line");
  assert.equal(readFileSync(join(dataDir, "cr.jsonl"), "utf8").length, before, "no join event");
});

test("a human may come back to a closed room to read; a concluded room still takes its seats back", (t) => {
  const { hub, room } = closed(t);
  const h = hub.join("cr", "benji", "human", {}, undefined, "sh").participant;
  assert.equal(h.active, true);
  assert.equal(room.state, "closed");
  const hub2 = new Hub();
  const x = hub2.join("cc", "X", "claude", { nudgeAfterMs: 0, requireChallenge: false }, undefined, "sx").participant;
  const y = hub2.join("cc", "Y", "claude", {}, undefined, "sy").participant;
  const r2 = hub2.getRoom("cc");
  t.after(() => { clearTimeout(r2.nudgeTimer); clearTimeout(r2.openingsTimer); });
  const pr = hub2.propose("cc", x.id, "Adopt the cache as measured on the bench set.");
  hub2.vote("cc", y.id, pr.id, "agree", undefined, undefined, "Adopt the cache as measured");
  assert.equal(r2.state, "concluded");
  hub2.leave("cc", y.id, "done");
  assert.equal(code(() => hub2.join("cc", "Y", "claude", {}, y.id, "sy2")), "none", "a concluded room is unchanged");
});
