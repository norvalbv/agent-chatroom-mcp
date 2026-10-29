/**
 * One row per room record, so two runs can be put side by side: hours, seats, cost, results and how many another seat
 * reviewed, reviewed results per hour, dollars per reviewed result and per finding, minutes to the first proposal and to
 * the conclusion, and when output fell away for good. Reads one file at a time; a file that is not a room log is skipped.
 *   npx tsx scripts/runs-table.ts <data/room.jsonl>... [--json] [--by-run]
 * --by-run adds one row per run (rooms grouped by their swarm-HHMMSS-xxxx prefix, a break-out with the room it was
 * opened from) whose cost counts each seat process once: a group lead sits in two rooms and its usage is in both logs,
 * so the per-room costs of a grouped run overlap.
 * A second table gives each room's seat yield (src/metrics/seat-yield.ts): agent seats, the most at once, seats with no
 * finding and the fewest seats that made 80% of the findings, so a room's record says whether its size paid.
 * It also gives each run's shape (src/metrics/run-shape.ts): flat, grouped or planned, and each break-out with its minute and opener.
 * And each room's RSI-7 measurements (src/measurements/room.ts), with how many rooms each one covered; CHATROOM_EMBED_URL
 * names the embedder ("embedder absent" without it), --width-labels / --provenance-labels add hand labels.
 */
import { readFileSync } from "node:fs";
import { parseRoomLog } from "../src/run-metrics.js";
import { renderSeatYield, type SeatYield, seatYield } from "../src/metrics/seat-yield.js";
import { renderRunTotals, renderRunsTable, runOf, runRow, runTotals, type RunRow } from "../src/run-timeline.js";
import { groupRuns, renderRunShapes, runShape } from "../src/metrics/run-shape.js";
import { embedderFromEnv, LABEL_FLAGS, measureRoom, readLabelOptions, renderMeasurementsTable, type RoomMeasurements } from "../src/measurements/room.js";

const argv = process.argv.slice(2);
const files = argv.filter((a, i) => !a.startsWith("--") && !LABEL_FLAGS.includes(argv[i - 1] ?? ""));
const measureOpts = { embedder: embedderFromEnv(), ...readLabelOptions(argv, (p) => readFileSync(p, "utf8")) };
if (!files.length) {
  console.error("usage: runs-table <room.jsonl>... [--json]");
  process.exit(2);
}
const rows: (RunRow & Omit<SeatYield, "room"> & { measurements: RoomMeasurements })[] = [];
const logs: ReturnType<typeof parseRoomLog>[] = [];
for (const f of files) {
  const events = parseRoomLog(readFileSync(f, "utf8"));
  if (!events.some((e) => e.type === "room")) continue;
  const row = { ...seatYield(events), ...runRow(events), measurements: await measureRoom(events, undefined, measureOpts) };
  rows.push(row);
  logs.push(events);
}
// a break-out goes with the room it was opened from, even when its name lacks the run's tag
const byRun = groupRuns(logs, runOf);
const runs = argv.includes("--by-run") ? [...byRun].map(([run, logs]) => ({ ...runTotals(logs, run), shape: runShape(logs, run) })) : undefined;
console.log(argv.includes("--json") ? JSON.stringify(runs ? { rooms: rows, runs } : rows, null, 2) : renderRunsTable(rows) + `\n${renderSeatYield(rows)}` + `\n${renderMeasurementsTable(rows.map((r) => r.measurements))}` + (runs ? `\n${renderRunTotals(runs)}\n${renderRunShapes(runs)}` : ""));
