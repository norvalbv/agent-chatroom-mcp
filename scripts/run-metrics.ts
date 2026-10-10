/**
 * Run metrics for any room from the hub's own log, no launcher and no hub needed: works on a crashed run or a past room.
 *   npx tsx scripts/run-metrics.ts <data/room.jsonl> [--json] [--repo <git dir>]
 * A cited commit is credited to its git author, looked up in the seats' claim workspaces, then --repo (default: the
 * current directory).
 */
import { readFileSync } from "node:fs";
import { gitShaAuthor, parseRoomLog, renderMetrics, roomRepos, runMetrics } from "../src/run-metrics.js";

const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--repo");
if (!file) {
  console.error("usage: run-metrics <room.jsonl> [--json] [--repo dir]");
  process.exit(2);
}
const repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd();
const events = parseRoomLog(readFileSync(file, "utf8"));
const m = runMetrics(events, { shaAuthor: gitShaAuthor(...roomRepos(events), repo) });
console.log(argv.includes("--json") ? JSON.stringify(m, null, 2) : renderMetrics(m));
