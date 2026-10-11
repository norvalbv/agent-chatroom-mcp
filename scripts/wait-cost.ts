/**
 * What each kind of turn cost in a run: model requests and dollars by the tool result that triggered them, empty waits
 * among them (src/wait-cost.ts says how, and what it undercounts). Pass every room log of the run(s): a seat in two
 * rooms is counted once.
 *   npx tsx scripts/wait-cost.ts <data/room.jsonl>... [--json] [--by-tool]
 * --by-tool adds the same requests split by the tool whose result woke the model (board_get, send_message, local Bash...).
 */
import { readFileSync, statSync } from "node:fs";
import { parseRoomLog } from "../src/run-metrics.js";
import { costByTool, emptyWaits, renderWaitCost, waitCost } from "../src/wait-cost.js";

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
const bad = files.filter((f) => !statSync(f, { throwIfNoEntry: false })?.isFile());
if (!files.length || bad.length) {
  console.error(bad.length ? `wait-cost: not a room log file: ${bad.join(", ")}` : "usage: wait-cost <room.jsonl>... [--json]");
  process.exit(2);
}
const logs = files.map((f) => parseRoomLog(readFileSync(f, "utf8")));
const rows = waitCost(logs), waits = emptyWaits(logs);
const tools = argv.includes("--by-tool") ? costByTool(logs) : undefined;
const toolTable = tools ? `\n\n| woke on | requests | cost | share |\n|---|---|---|---|\n${tools.slice(0, 20).map((t) => `| ${t.tool} | ${t.requests} | $${t.cost_usd.toFixed(2)} | ${Math.round(t.share * 100)}% |`).join("\n")}` : "";
console.log(argv.includes("--json") ? JSON.stringify({ rows, waits, ...(tools ? { tools } : {}) }, null, 2)
  : `${renderWaitCost(rows)}\n${waits.waits} waits, ${waits.empty} returned nothing after a median ${waits.median_empty_s ?? "-"} s (${waits.empty_seat_minutes} seat-minutes spent in them: the more minutes per empty wait, the fewer requests they cost).${toolTable}`);
