/**
 * Refusals by tool and typed code, and how many the same seat got past within 5 minutes (src/refusal-metrics.ts).
 *   npx tsx scripts/refusals-table.ts <data/room.jsonl>... [--json]
 * Logs from before the typed codes show their guard refusals as hub_guard; they are never reclassified.
 */
import { readFileSync, statSync } from "node:fs";
import { parseRoomLog } from "../src/run-metrics.js";
import { refusalTable, renderRefusalTable } from "../src/refusal-metrics.js";

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: refusals-table <room.jsonl>... [--json]");
  process.exit(2);
}
// a directory or a missing path is a usage mistake, said as one, not a stack trace (the verifier's note on f7fc3097)
const bad = files.filter((f) => !statSync(f, { throwIfNoEntry: false })?.isFile());
if (bad.length) {
  console.error(`refusals-table: not a room log file: ${bad.join(", ")}. Pass data/<room>.jsonl files, e.g. data/*.jsonl`);
  process.exit(2);
}
const events = files.flatMap((f) => parseRoomLog(readFileSync(f, "utf8")));
const rows = refusalTable(events);
console.log(argv.includes("--json") ? JSON.stringify(rows, null, 2) : renderRefusalTable(rows));
