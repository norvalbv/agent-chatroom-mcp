/**
 * One row per room record, so two runs can be put side by side: hours, seats, cost, results and how many another seat
 * reviewed, reviewed results per hour, dollars per reviewed result and per finding, minutes to the first proposal and to
 * the conclusion, and when output fell away for good. Reads one file at a time; a file that is not a room log is skipped.
 *   npx tsx scripts/runs-table.ts <data/room.jsonl>... [--json] [--by-run]
 * --by-run adds one row per run (rooms grouped by their swarm-HHMMSS-xxxx prefix) whose cost counts each seat process
 * once: a group lead sits in two rooms and its usage is in both logs, so the per-room costs of a grouped run overlap.
 * It also gives each run's shape (src/metrics/run-shape.ts): flat, grouped or planned, and each break-out with its minute and opener.
 */
import { readFileSync } from "node:fs";
import { parseRoomLog } from "../src/run-metrics.js";
import { renderRunTotals, renderRunsTable, runOf, runRow, runTotals, type RunRow } from "../src/run-timeline.js";
import { renderRunShapes, runShape } from "../src/metrics/run-shape.js";

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: runs-table <room.jsonl>... [--json]");
  process.exit(2);
}
const rows: RunRow[] = [];
const byRun = new Map<string, ReturnType<typeof parseRoomLog>[]>();
for (const f of files) {
  const events = parseRoomLog(readFileSync(f, "utf8"));
  if (!events.some((e) => e.type === "room")) continue;
  const row = runRow(events);
  rows.push(row);
  (byRun.get(runOf(row.room)) ?? byRun.set(runOf(row.room), []).get(runOf(row.room))!).push(events);
}
const runs = argv.includes("--by-run") ? [...byRun].map(([run, logs]) => ({ ...runTotals(logs, run), shape: runShape(logs, run) })) : undefined;
console.log(argv.includes("--json") ? JSON.stringify(runs ? { rooms: rows, runs } : rows, null, 2) : renderRunsTable(rows) + (runs ? `\n${renderRunTotals(runs)}\n${renderRunShapes(runs)}` : ""));
