/** scripts/brainstorm-breadth.ts counts an idea as addressed from the room's whole history, by exact key (review of
 * 2c6a0e82 by 6-astra-4: final-state substring matching let attack/idea/xy credit idea/x, and clearing a finished
 * claim erased it). "Addressed" stays a textual record, not proof the idea was tested.
 *   npx tsx scripts/brainstorm-breadth-regression.ts */
import assert from "node:assert/strict";
import { breadth } from "./brainstorm-breadth.ts";

let t = 0;
const at = () => new Date(Date.UTC(2026, 9, 27, 8, 0, t++)).toISOString();
const write = (key: string, text: string) => ({ type: "board", room: "r", key, entry: { text, by: "a", updatedAt: at() } });
const events = [
  { type: "room", room: "r", ts: at() },
  write("idea/x", "Momentum tilt; check: split fills by 30 s move."),
  write("idea/xy", "Queue position; check: first-batch share."),
  write("idea/z", "Rebates; check: after-fee P&L without them."),
  write("idea/w", "Copy the leader; check: replay its fills."),
  write("idea/v", "dropped: no data for it."),
  write("attack/idea/xy", "Not distinct from idea/x's check."),
  write("claim/z", "Testing the rebate split."),
  write("claim/z", ""),
  write("claim/other", "Building the tape; uses idea/w as the first replay."),
  write("idea/v", "Unsettled again after a rewrite."),
];
const row = breadth(events, "r");
assert.equal(row.ideas, 5);
// idea/xy: attacked; idea/z: claimed then cleared (still addressed); idea/w: named by exact key in a claim; idea/v: once
// settled "dropped:". idea/x: only a prefix of attack/idea/xy and a mention inside idea/xy's attack text: never addressed.
assert.equal(row.addressed, 4, `addressed by history and exact key: ${JSON.stringify(row)}`);
assert.equal(row.never_addressed, 1, "idea/x is never addressed");

const prefix = breadth([{ type: "room", room: "p", ts: at() }, write("idea/a", "A"), write("claim/b", "Working on idea/ab and idea/a-2.")], "p");
assert.equal(prefix.addressed, 0, "idea/ab and idea/a-2 in a claim do not name idea/a");
const named = breadth([{ type: "room", room: "n", ts: at() }, write("idea/a", "A"), write("claim/b", "Working on idea/a.")], "n");
assert.equal(named.addressed, 1, "a sentence-final period still names idea/a");

// An idea attacked, conceded and then cleared before the end (arm B of probe/brainstorm-prereg, swarm-085234-dn6b) was
// addressed: the count is over every idea ever written, not the final board's.
const cleared = breadth([{ type: "room", room: "c", ts: at() }, write("idea/a", "A"), write("idea/b", "B"),
  write("attack/idea/a", "Not the lead."), write("idea/a", "WITHDRAWN: conceded."), write("idea/a", "")], "c");
assert.equal(cleared.ideas, 2, `both ideas ever written count: ${JSON.stringify(cleared)}`);
assert.equal(cleared.addressed, 1, "the attacked-then-cleared idea was addressed");
assert.equal(cleared.never_addressed, 1, "idea/b was never addressed");

console.log("brainstorm-breadth-regression: OK");
