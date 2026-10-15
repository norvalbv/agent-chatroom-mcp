/**
 * What each kind of turn cost in a run: model requests and dollars by the tool result that triggered them, empty waits
 * among them (src/wait-cost.ts says how, and what it undercounts). Pass every room log of the run(s): a seat in two
 * rooms is counted once.
 *   npx tsx scripts/wait-cost.ts <data/room.jsonl>... [--json] [--by-tool]
 * --traffic adds what each hub tool put into seats' contexts (result_chars, hub builds from swarm-092526-89rn on) and that
 * traffic's share of all context the seats wrote.
 * --by-tool adds the same requests split by the tool whose result woke the model (board_get, send_message, local Bash...).
 * --by-key adds keyed hub calls by board area ("board_set inbox/*.ack", "board_get ledger/*"): what cross-room notes cost.
 */
import { readFileSync, statSync } from "node:fs";
import { parseRoomLog } from "../src/run-metrics.js";
import { costByKey, costByTool, emptyWaits, renderWaitCost, roomTraffic, trafficReread, trafficShare, waitCost } from "../src/wait-cost.js";

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
const keys = argv.includes("--by-key") ? costByKey(logs) : undefined;
const keyTable = keys ? `\n\n| keyed hub call | requests | cost | share of all |\n|---|---|---|---|\n${keys.slice(0, 15).map((t) => `| ${t.tool} | ${t.requests} | $${t.cost_usd.toFixed(2)} | ${(t.share * 100).toFixed(1)}% |`).join("\n")}` : "";
const toolTable = tools ? `\n\n| woke on | requests | cost | share |\n|---|---|---|---|\n${tools.slice(0, 20).map((t) => `| ${t.tool} | ${t.requests} | $${t.cost_usd.toFixed(2)} | ${Math.round(t.share * 100)}% |`).join("\n")}${((rest) => (rest.length ? `\n| other (${rest.length} tools) | ${rest.reduce((n, t) => n + t.requests, 0)} | $${rest.reduce((n, t) => n + t.cost_usd, 0).toFixed(2)} | ${Math.round(rest.reduce((n, t) => n + t.share, 0) * 100)}% |` : ""))(tools.slice(20))}` : "";
const traffic = argv.includes("--traffic") ? { tools: roomTraffic(logs), ...trafficShare(logs), reread: trafficReread(logs) } : undefined;
const trafficTable = traffic ? (traffic.tools.length
  ? `\n\nRoom traffic: ~${traffic.hub_tokens_est} tokens returned by hub calls of ${traffic.context_written_tokens} new tokens written into seat contexts, ${traffic.rewritten_tokens} more rewritten (${traffic.share === undefined ? "-" : Math.round(traffic.share * 100) + "%"}; chars/4, an estimate, a lower bound). Re-read by later requests: ~${traffic.reread.hub_reread_tokens_est} of ${traffic.reread.cache_read_tokens} cache-read tokens (${traffic.reread.share === undefined ? "-" : Math.round(traffic.reread.share * 100) + "%"}; no compaction modelled, an upper bound).\n\n| hub tool | calls | result chars | chars per call | args chars | share |\n|---|---|---|---|---|---|\n${traffic.tools.map((t) => `| ${t.tool} | ${t.calls} | ${t.result_chars} | ${Math.round(t.result_chars / t.calls)} | ${t.args_chars} | ${Math.round(t.share * 100)}% |`).join("\n")}`
  : "\n\nRoom traffic: these logs record no result sizes (result_chars is recorded only by hub builds with scripts/result-chars-regression.ts).") : "";
console.log(argv.includes("--json") ? JSON.stringify({ rows, waits, ...(tools ? { tools } : {}), ...(keys ? { keys } : {}), ...(traffic ? { traffic } : {}) }, null, 2)
  : `${renderWaitCost(rows)}\n${waits.waits} waits, ${waits.empty} returned nothing after a median ${waits.median_empty_s ?? "-"} s (${waits.empty_seat_minutes} seat-minutes spent in them: the more minutes per empty wait, the fewer requests they cost).${toolTable}${keyTable}${trafficTable}`);
