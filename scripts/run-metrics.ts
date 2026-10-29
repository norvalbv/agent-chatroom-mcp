/**
 * Run metrics for any room from the hub's own log, no launcher and no hub needed: works on a crashed run or a past room.
 * One row per seat for the whole run, then the run on a time axis (src/run-timeline.ts): what each half hour produced
 * and cost, each seat's context per model request, when output fell away, the longest silence in the log.
 *   npx tsx scripts/run-metrics.ts <data/room.jsonl> [--json] [--repo <git dir>] [--width-labels f.json] [--provenance-labels f.json]
 * Then RSI-7's four room measurements (src/measurements/room.ts), as the run report prints them: CHATROOM_EMBED_URL names
 * the embedder, and without it the two blocks that need one say "embedder absent".
 * A cited commit is credited to its git author, looked up in the seats' claim workspaces, then --repo (default: the
 * current directory).
 */
import { readFileSync } from "node:fs";
import { gitShaAuthor, parseRoomLog, renderMetrics, roomRepos, runMetrics } from "../src/run-metrics.js";
import { renderTimeline, runTimeline } from "../src/run-timeline.js";
import { embedderFromEnv, LABEL_FLAGS, measureRoom, readLabelOptions, renderMeasurements } from "../src/measurements/room.js";

const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith("--") && !["--repo", ...LABEL_FLAGS].includes(argv[i - 1] ?? ""));
if (!file) {
  console.error("usage: run-metrics <room.jsonl> [--json] [--repo dir] [--width-labels f.json] [--provenance-labels f.json]");
  process.exit(2);
}
const repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd();
const events = parseRoomLog(readFileSync(file, "utf8"));
const m = runMetrics(events, { shaAuthor: gitShaAuthor(...roomRepos(events), repo) });
const timeline = runTimeline(events);
const measurements = await measureRoom(events, undefined, { embedder: embedderFromEnv(), ...readLabelOptions(argv, (p) => readFileSync(p, "utf8")) });
console.log(argv.includes("--json") ? JSON.stringify({ ...m, timeline, measurements }, null, 2) : renderMetrics(m) + renderTimeline(timeline) + renderMeasurements([measurements]));
