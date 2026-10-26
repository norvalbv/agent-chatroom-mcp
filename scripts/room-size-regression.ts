/** Room size (owner ask 4, decision/room-size in swarm-005940-77tu-room). In this hub's records an extra seat adds a
 * seat's cost and a seat's board output, but not landed results: Study 3's 15-seat room landed no more of a 20-item pool
 * than a 3-seat one at 2.5-3.5x the cost per item, and across Claude rooms the share of seats with no finding rose from
 * 4% (2-3 seats) to 18% (13+). So (1) the launcher prints a size note, never a refusal (settled axis
 * flat-seats-capped-per-model), when one room will hold more than 6 agents, and records the sizing in result.json, and
 * (2) runs-table shows each room's seat yield, so a later room's record says whether its size paid.
 * Run: npx tsx scripts/room-size-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const est = (await import("../src/cost-estimate.js")) as Record<string, unknown>;
assert.equal(typeof est.launchSizeNote, "function", "src/cost-estimate.ts exports launchSizeNote");
assert.equal(typeof est.launchGuide, "function", "src/cost-estimate.ts exports launchGuide");
const launchSizeNote = est.launchSizeNote as (o: { roomSeats: number; workers: number; briefItems: number }) => string;
type Guide = { total: number; timeoutMin: number; flat: boolean; groupWorkers?: number[]; task: string; seatTargets: boolean };
const launchGuide = est.launchGuide as (o: Guide, log: (line: string) => void) => unknown;

// up to 6 agents in a room: nothing printed (the default 4, and the owner's usual 5 + verifier)
for (const n of [2, 4, 5, 6]) assert.equal(launchSizeNote({ roomSeats: n, workers: n - 1, briefItems: 0 }), "", `${n} seats: no note`);
// 7 and up: one line with the measured numbers, and it says it is not a cap
const seven = launchSizeNote({ roomSeats: 7, workers: 6, briefItems: 0 });
assert.match(seven, /^size note: 7 agents in one room\./);
assert.match(seven, /not a cap/, "a note, never a refusal (flat-seats-capped-per-model)");
assert.match(seven, /recruit/, "points at growing by recruiting into named items");
assert.match(seven, /Study 3|20-item pool/, "cites the same-brief evidence");
assert.doesNotMatch(seven, /second angle/, "no brief list: no item-count line");
// a numbered brief with fewer items than workers: say how many seats start on an item another seat already has
const fifteen = launchSizeNote({ roomSeats: 15, workers: 14, briefItems: 5 });
assert.match(fifteen, /The brief lists 5 items for 14 workers: 9 start on a second angle of an item another seat has\./);
// enough items for every worker: no item-count line
assert.doesNotMatch(launchSizeNote({ roomSeats: 8, workers: 7, briefItems: 7 }), /second angle/);
// a small room whose brief lists fewer items than workers is still not nagged
assert.equal(launchSizeNote({ roomSeats: 5, workers: 4, briefItems: 2 }), "");

// the launcher's guide: the cost line always, the size note after it, and a sizing record for result.json
const task = "Fix three things:\n1. the parser\n2. the cache\n3. the docs";
const guide = (o: Partial<Guide>) => {
  const lines: string[] = [];
  const sizing = launchGuide({ total: 4, timeoutMin: 30, flat: true, task, seatTargets: true, ...o }, (l) => lines.push(l));
  return { lines, sizing };
};
const flat7 = guide({ total: 7 });
assert.equal(flat7.lines.length, 2);
assert.match(flat7.lines[0], /^cost guide: 7 seat\(s\)/);
assert.match(flat7.lines[1], /^size note: 7 agents in one room\..*The brief lists 3 items for 6 workers: 3 start on a second angle/);
assert.deepEqual(flat7.sizing, { room_seats: 7, workers: 6, brief_items: 3, note: true }, "--flat: every agent in one room, the verifier is not a worker");
const flat4 = guide({ total: 4 });
assert.equal(flat4.lines.length, 1, "the default size: the cost guide only");
assert.deepEqual(flat4.sizing, { room_seats: 4, workers: 3, brief_items: 3, note: false });
assert.deepEqual(guide({ total: 7, seatTargets: false }).sizing, { room_seats: 7, workers: 6, brief_items: 0, note: true }, "--no-seat-targets: no seat starts on a listed item");
const groups = guide({ total: 12, flat: false, groupWorkers: [3, 8] });
assert.match(groups.lines[1] ?? "", /^size note: 8 agents in one room\./, "--groups: the largest group room is what is sized");
assert.deepEqual(groups.sizing, { room_seats: 8, workers: 8, brief_items: 0, note: true });
const planned = guide({ total: 9, flat: false });
assert.equal(planned.lines.length, 1, "a planned run's rooms are the planner's to size");
assert.equal(planned.sizing, undefined);
// and the launcher calls it and keeps the record
const swarm = readFileSync("src/swarm.ts", "utf8");
assert.match(swarm, /= launchGuide\(/, "src/swarm.ts prints the guide through launchGuide");
assert.match(swarm, /sizing: SIZING/, "result.json carries the sizing record");

// seat yield per room
const { seatYield } = (await import("../src/metrics/seat-yield.js")) as any;
const T0 = Date.parse("2026-10-10T09:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const join_ = (id: string, name: string, min: number, role?: string, agent = "claude") => ({ type: "join", room: "r", p: { id, name, agent, joinedAt: at(min), ...(role ? { role } : {}) } });
const leave = (id: string, name: string, min: number) => ({ type: "leave", room: "r", p: { id, name, agent: "claude", lastActiveAt: at(min), active: false } });
const board = (key: string, by: string, min: number) => ({ type: "board", room: "r", key, entry: { text: "x", by, updatedAt: at(min) } });
const events = [
  { type: "room", room: "r", opts: { topic: "GOAL: size\nmore" }, createdAt: at(0) },
  join_("p_c", "chair-claude", 0, "chair"), // a chair is not a seat
  join_("p_h", "benji", 0, undefined, "human"), // nor is a human
  join_("p_a", "a", 0), join_("p_b", "b", 0), join_("p_v", "verifier", 0, "verifier"),
  board("resource/x", "launcher", 0), // seeded, not found
  board("evidence/1", "a", 5), board("evidence/2", "a", 6), board("evidence/3", "a", 7), board("evidence/4", "a", 8),
  board("evidence/5", "b", 9), board("claim/a", "verifier", 9), // a claim is coordination, not a finding
  board("evidence/1", "b", 10), // a rewrite of a key is not a second finding
  board("evidence/6", "chair-claude", 11), // the chair's entry is not a seat's
  leave("p_b", "b", 20),
  join_("p_r", "recruit-1", 30, "recruit"), join_("p_s", "recruit-2", 31, "recruit"),
  join_("p_a", "a", 32), // a rejoin by the same seat is not a new seat
  board("verify/x", "recruit-1", 40),
  { type: "state", room: "r", conclusion: { text: "done", decidedAt: at(60) } },
];
const y = seatYield(events);
assert.equal(y.room, "r");
assert.equal(y.peakSeats, 4, "a, verifier, recruit-1, recruit-2 at once after b left; chair and human not counted");
assert.equal(y.agentSeats, 5, "a, b, verifier, recruit-1, recruit-2");
assert.equal(y.idleSeats, 2, "verifier (a claim only) and recruit-2 made no finding");
assert.equal(y.seatsFor80, 2, "a (4) + b (1) = 5 of 6 findings >= 80%");
assert.deepEqual(seatYield([{ type: "room", room: "e", opts: { topic: "x" }, createdAt: at(0) }]), { room: "e", agentSeats: 0, peakSeats: 0, idleSeats: 0, seatsFor80: 0 });

// runs-table prints it beside the run table, a dash for a room with no agent seats, and carries it in --json
const dir = mkdtempSync(join(tmpdir(), "room-size-"));
try {
  writeFileSync(join(dir, "r.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(join(dir, "e.jsonl"), JSON.stringify({ type: "room", room: "e", opts: { topic: "x" }, createdAt: at(0) }) + "\n");
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/runs-table.ts", ...args, join(dir, "r.jsonl"), join(dir, "e.jsonl")], { encoding: "utf8" });
  const md = run();
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /^\| room \| seats \(peak\) \| idle seats \| seats making 80% of findings \|$/m);
  assert.match(md.stdout, /^\| r \| 5 \(4\) \| 2 \| 2 \|$/m);
  assert.match(md.stdout, /^\| e \| - \| - \| - \|$/m, "no agent seats: a dash, never a made-up zero");
  const json = run("--json");
  assert.equal(json.status, 0, json.stderr);
  const rows = JSON.parse(json.stdout);
  assert.deepEqual([rows[0].room, rows[0].agentSeats, rows[0].peakSeats, rows[0].idleSeats, rows[0].seatsFor80], ["r", 5, 4, 2, 2]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// the operator's guide says the same threshold the launcher uses, and where to read a room's seat yield
const skill = readFileSync("skills/swarm/SKILL.md", "utf8");
const above = est.SIZE_NOTE_ABOVE as number;
assert.match(skill, new RegExp(`Above ${above} in one room the launcher prints a size note`), "--agents names the note's threshold");
assert.match(skill, new RegExp(`\\*\\*Grow a room by recruiting into a named item, not by launching wide\\*\\*[^\\n]*\\n(?:[^\\n]*\\n)*?[^\\n]*Above ${above} agents in one room the launcher prints a size note[^\\n]*scripts/runs-table\\.ts`), "Sizing a run: the evidence, the note and the seat-yield table");
assert.doesNotMatch(skill, /"lots" = 8/, "no fixed 8 for \"lots\": start at 5 to 6 and recruit");

console.log("room-size regression: ok");
