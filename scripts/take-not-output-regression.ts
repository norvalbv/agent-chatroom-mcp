/**
 * A take/<what> entry is a reservation, not output, work or a finding (evidence-pack item 12, merge-review backlog item 3
 * in docs/self-improvement-swarm-003601-tky5.md, rated High). take/ shipped at 3b62edb8 and was missing from all four
 * hand-kept prefix lists (output.ts coordinates, open-work.ts NOT_WORK, work.ts NOT_FINDINGS, board.ts NOT_A_FINDING):
 * a seat that wrote only take/x counted as having delivered, so it escaped the no-output record; its claim did not read
 * as barren; and a long take was listed as an unexamined finding that holds a proposal. The four sites now read one
 * shared list (src/hub/keys.ts), so the next reserved prefix is added once.
 * Run: npx tsx --test scripts/take-not-output-regression.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Hub } from "../src/hub.js";
import { COORDINATION_PREFIXES } from "../src/hub/keys.js";
import { barrenClaims } from "../src/hub/work.js";
import { runMetrics } from "../src/run-metrics.js";
import { runRow } from "../src/run-timeline.js";

const LONG = "holding the benchmark machine for the 12:00-16:00 scoring window; nothing else may run on it until I release this. ".repeat(3);

function fixture(t: { after: (fn: () => void) => void }) {
  const hub = new Hub();
  const name = "take-not-output";
  const a = hub.join(name, "Alice", "claude", { requireChallenge: false, expectedParticipants: 2 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "claude", {}, undefined, "session-b").participant;
  const room = hub.getRoom(name);
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  return { hub, room, a, b };
}
const output = (hub: Hub, room: ReturnType<Hub["getRoom"]>, name: string) =>
  (hub.summary(room).participants as { name: string; output: { evidence: number; claims: number } }[]).find((p) => p.name === name)!.output;

test("a seat that wrote only a claim and a take has delivered nothing, and its claim is barren", (t) => {
  const { hub, room, a, b } = fixture(t);
  hub.setBoard(room.name, a.id, "claim/bench", JSON.stringify({ area: "bench", owner: "Alice", team: ["Alice"], status: "open", note: "the scoring run" }));
  hub.setBoard(room.name, a.id, "take/bench-machine", LONG);
  assert.equal(output(hub, room, "Alice").evidence, 0, "a take is a reservation, not evidence");
  assert.deepEqual(barrenClaims(room, [a, b]), ["claim/bench (Alice)"], "the claim's owner has put nothing but the claim and a take on the board");
  assert.deepEqual(hub.scrutiny(room.name).unexamined, [], "a take is never an unexamined finding, however long");
  assert.throws(() => hub.setBoard(room.name, b.id, "attack/take/bench-machine", 'I object to "holding the benchmark machine for the 12:00-16:00 scoring window"'), /coordination state/);
  // a real finding still counts, and clears the barren claim
  hub.setBoard(room.name, a.id, "result/bench", "scored 41 of 42 on the held-out set; the one miss is the shifted-input row");
  assert.equal(output(hub, room, "Alice").evidence, 1);
  assert.deepEqual(barrenClaims(room, [a, b]), []);
});

test("every coordination prefix is read the same way at all four sites", (t) => {
  const { hub, room, a, b } = fixture(t);
  assert.deepEqual([...COORDINATION_PREFIXES].sort(), ["claim/", "hold/", "inbox/", "take/"]);
  hub.setBoard(room.name, a.id, "claim/x", JSON.stringify({ area: "x", owner: "Alice", team: ["Alice"], status: "open", note: LONG }));
  hub.setBoard(room.name, a.id, "take/x", LONG);
  hub.setBoard(room.name, a.id, `hold/${room.name}`, LONG);
  assert.equal(output(hub, room, "Alice").evidence, 0);
  assert.deepEqual(barrenClaims(room, [a, b]), ["claim/x (Alice)"]);
  assert.deepEqual(hub.scrutiny(room.name).unexamined, []);
});

test("the offline readers count a take as neither a finding nor credit (runs table, run metrics)", () => {
  const at = (s: number) => new Date(Date.parse("2026-10-11T18:00:00Z") + s * 1000).toISOString();
  const p = (name: string) => ({ id: `p_${name}`, name, agent: "claude", active: true });
  const board = (key: string, by: string, s: number) => ({ type: "board", room: "r", key, entry: { text: LONG, by, updatedAt: at(s) } });
  const log = [
    { type: "room", room: "r", opts: { topic: "t" }, createdAt: at(0) },
    { type: "join", room: "r", p: p("Alice") }, { type: "join", room: "r", p: p("Bob") },
    board("take/bench-machine", "Alice", 10), board("claim/bench", "Alice", 11), board("result/bench", "Bob", 20),
  ];
  assert.equal(runRow(log as never).findings, 1, "the runs table's findings column: Bob's result only");
  const seats = runMetrics(log as never).seats as { name: string; findings: number }[];
  assert.deepEqual(seats.map((s) => [s.name, s.findings]).sort(), [["Alice", 0], ["Bob", 1]]);
});
