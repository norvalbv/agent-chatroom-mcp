/** "Gets further per hour and per dollar than its last room" was the bar for the next Polymarket room, and no tool put two
 * runs side by side: each seat compared rooms by reading their logs by hand. runs-table prints one row per room record.
 * Run: npx tsx scripts/runs-table-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mod = await import("../src/run-timeline.js");
assert.equal(typeof (mod as Record<string, unknown>).runRow, "function", "src/run-timeline.ts exports runRow");
const { runRow, renderRunsTable } = mod as any;

const T0 = Date.parse("2026-10-10T09:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const board = (key: string, by: string, min: number) => ({ type: "board", room: "r", key, entry: { text: "x", by, updatedAt: at(min) } });
const usage = (seat: string, min: number, cost: number, out: number) => ({ type: "usage", room: "r", seat, ts: at(min), usage: { requests: min, output_tokens: out, cost_usd: cost } });
const events = [
  { type: "room", room: "r", opts: { topic: "GOAL: find a way to make money\nmore" }, createdAt: at(0) },
  { type: "join", room: "r", p: { id: "p_a", name: "a", agent: "claude", joinedAt: at(0), seatKeyHash: "ka" } },
  { type: "join", room: "r", p: { id: "p_b", name: "b", agent: "claude", joinedAt: at(0), seatKeyHash: "kb" } },
  usage("ka", 1, 0, 0), usage("kb", 1, 0, 0),
  board("result/x", "a", 30), board("rerun/x", "b", 40), board("result/y", "b", 50), board("evidence/z", "a", 55),
  usage("ka", 59, 30, 100_000), usage("kb", 59, 30, 100_000), usage("ka", 89, 40, 101_000), usage("kb", 89, 40, 101_000),
  usage("ka", 120, 50, 102_000), usage("kb", 120, 50, 102_000),
  { type: "proposal", room: "r", proposal: { id: "p1", createdAt: at(100), text: "x", by: { id: "p_a" } } },
  { type: "state", room: "r", conclusion: { text: "done", decidedAt: at(110) } },
];
const row = runRow(events);
assert.equal(row.room, "r");
assert.equal(row.task, "GOAL: find a way to make money", "the topic's first line");
assert.equal(row.hours, 2, "first to last event");
assert.equal(row.seats, 2);
assert.equal(row.costUsd, 100);
assert.equal(row.results, 2);
assert.equal(row.reviewed, 1, "a result another seat reran");
assert.equal(row.findings, 4, "result/x, rerun/x, result/y, evidence/z: not claim/, draft/, inbox/, hold/");
assert.equal(row.firstProposalMin, 100);
assert.equal(row.conclusionMin, 110);
assert.equal(row.quietFromMin, 60, "output fell away an hour in");
assert.equal(row.reviewedPerHour, 0.5);
assert.equal(row.usdPerReviewed, 100);
assert.equal(row.usdPerFinding, 25);

const md = renderRunsTable([row, { ...row, room: "s", costUsd: undefined, usdPerReviewed: undefined }]);
assert.match(md, /\| r \| GOAL: find a way to make money \| 2 \| 2 \| \$100 \| 2 \/ 1 \| 0\.5 \| \$100 \| 4 \| \$25 \| 100 \| 110 \| 60 \|/);
assert.match(md, /\| s \|.*\| \? \|/, "unknown cost is shown as unknown, never as zero");

// the command reads files one at a time and skips what is not a room log
const dir = mkdtempSync(join(tmpdir(), "runs-table-"));
try {
  writeFileSync(join(dir, "r-room.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(join(dir, "junk.jsonl"), "not json\n");
  const { spawnSync } = await import("node:child_process");
  const out = spawnSync(process.execPath, ["--import", "tsx", "scripts/runs-table.ts", join(dir, "r-room.jsonl"), join(dir, "junk.jsonl")], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\| r \| GOAL/);
  assert.doesNotMatch(out.stdout, /junk/);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log("RUNS TABLE OK");
