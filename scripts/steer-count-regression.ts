/**
 * How often a room needed steering, read from its own log: the owner asked that rooms be proactive ("there was a few
 * times that I had to step in"), and no record counted the times he or a chair did. A steer is a chat message from a
 * human or a chair-role seat, or an inbox/* note a human or chair wrote into the room (an .ack is not one); a note
 * rewritten under the same key is a correction and is counted as such.
 * Run: npx tsx scripts/steer-count-regression.ts
 */
import assert from "node:assert/strict";
import { steerCount } from "../src/telemetry/steer-count.js";

const t = (min: number) => new Date(Date.UTC(2026, 9, 13, 13, min)).toISOString();
const join = (name: string, agent: string, role?: string) => ({ type: "join", room: "r", p: { id: `p_${name}`, name, agent, ...(role ? { role } : {}), joinedAt: t(0) } });
const chat = (name: string, agent: string, min: number, content: string, kind = "chat") => ({ type: "message", msg: { kind, from: { id: `p_${name}`, name, agent }, content, ts: t(min) } });
const note = (key: string, by: string, min: number) => ({ type: "board", room: "r", key, entry: { text: "x", by, updatedAt: t(min) } });

const room = [
  { type: "room", room: "r", opts: {}, ts: t(0) },
  join("chair-claude", "claude", "chair"), join("benji", "human"), join("w1", "claude"), join("w2", "claude"),
  chat("w1", "claude", 1, "starting"),
  chat("chair-claude", "claude", 10, "@w1 you skipped the fee model"),
  chat("benji", "human", 20, "be proactive"),
  chat("chair-claude", "claude", 21, "noted", "board"),
  note("inbox/leads/ruling-1", "chair-claude", 30),
  note("inbox/leads/ruling-1", "chair-claude", 40),
  note("inbox/leads/ruling-1.ack", "w1", 41),
  note("inbox/leads/fact", "w2", 42),
  { ...note("inbox/leads/ruling-1-fix", "chair-claude", 44), entry: { text: "From the chair, a correction to my note ruling-1", by: "chair-claude", updatedAt: t(44) } },
  note("plan", "chair-claude", 43),
];
const [r] = steerCount([room as never]);
assert.equal(r.room, "r");
assert.equal(r.human_messages, 1, "one human chat");
assert.equal(r.chair_messages, 1, "one chair chat; its board notice is not a steer");
assert.equal(r.addressed, 1, "the chair's message @-addressed a seat");
assert.equal(r.notes, 1, "one inbox note by the chair; the .ack and the seat's own note are not steers");
assert.equal(r.corrections, 2, "the same note rewritten once, and a new note that says it corrects one");
assert.equal(r.steers, 5, "1 human + 1 chair chat + 1 note + 2 corrections");
assert.equal(r.first_steer_min, 10, "first steer 10 minutes after the room opened");
assert.equal(r.seats, 2, "two working seats read each steer");
assert.equal(steerCount([[{ type: "room", room: "q", opts: {}, ts: t(0) }] as never])[0].steers, 0);
const early = steerCount([room as never], 15)[0];
assert.equal(early.steers, 1, "--minutes 15: only the chair's message at minute 10");
console.log("steer-count regression: ok");
