/**
 * How often each room needed steering by a human or a chair (src/steer-count.ts says what counts). Pass every room log
 * of a run: a chair seen joining any of them is a chair in all.
 *   npx tsx scripts/steer-count.ts <data/room.jsonl>... [--json] [--minutes N]
 * --minutes N counts only each room's first N minutes (a 45-minute probe against the first 45 minutes of a long run).
 */
import { readFileSync, statSync } from "node:fs";
import { parseRoomLog } from "../src/run-metrics.js";
import { renderSteers, steerCount } from "../src/telemetry/steer-count.js";

const argv = process.argv.slice(2);
const minutes = argv.includes("--minutes") ? Number(argv[argv.indexOf("--minutes") + 1]) : Infinity;
const files = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--minutes");
const bad = files.filter((f) => !statSync(f, { throwIfNoEntry: false })?.isFile());
if (!files.length || bad.length) {
  console.error(bad.length ? `steer-count: not a room log file: ${bad.join(", ")}` : "usage: steer-count <room.jsonl>... [--json]");
  process.exit(2);
}
const rows = steerCount(files.map((f) => parseRoomLog(readFileSync(f, "utf8"))), minutes);
console.log(argv.includes("--json") ? JSON.stringify(rows, null, 2) : renderSteers(rows));
