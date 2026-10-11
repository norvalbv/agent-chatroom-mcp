/**
 * One row per room record, so two runs can be put side by side: hours, seats, cost, results and how many another seat
 * reviewed, reviewed results per hour, dollars per reviewed result and per finding, minutes to the first proposal and to
 * the conclusion, and when output fell away for good. Reads one file at a time; a file that is not a room log is skipped.
 *   npx tsx scripts/runs-table.ts <data/room.jsonl>... [--json]
 */
import { readFileSync } from "node:fs";
import { parseRoomLog } from "../src/run-metrics.js";
import { renderRunsTable, runRow, type RunRow } from "../src/run-timeline.js";

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: runs-table <room.jsonl>... [--json]");
  process.exit(2);
}
const rows: RunRow[] = [];
for (const f of files) {
  const events = parseRoomLog(readFileSync(f, "utf8"));
  if (!events.some((e) => e.type === "room")) continue;
  rows.push(runRow(events));
}
console.log(argv.includes("--json") ? JSON.stringify(rows, null, 2) : renderRunsTable(rows));
