/** Offline next-run triage for any saved result. --logs backfills missing per-room metrics from recorded logs.
 * Usage: npx tsx scripts/run-feedback.ts <result.json> [--logs <data-dir>] [--json]
 * Reads only: never rewrites the source artifact or fetches a live hub. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readRunResult } from "../src/result.js";
import { parseRoomLog, runMetrics } from "../src/run-metrics.js";
import { renderFeedback, runFeedback } from "../src/telemetry/feedback.js";

const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--logs");
if (!file || argv.includes("--help")) {
  console.error("usage: run-feedback <result.json> [--logs <data-dir>] [--json]");
  process.exit(argv.includes("--help") ? 0 : 2);
}
const run = readRunResult(file);
const logAt = argv.indexOf("--logs");
if (logAt >= 0 && !argv[logAt + 1]) throw new Error("--logs requires a recorded data directory");
const logs = logAt >= 0 ? resolve(argv[logAt + 1]) : undefined;
for (const room of run.rooms) {
  if (!room.metrics && room.name === run.leadRoom && run.metrics) room.metrics = run.metrics;
  if (!logs || room.metrics) continue;
  const path = resolve(logs, `${room.name}.jsonl`);
  if (dirname(path) !== logs) throw new Error(`Room name leaves the recorded data directory: ${room.name}`);
  if (!existsSync(path)) { room.metricsError = "recorded log unavailable"; continue; }
  const raw = readFileSync(path, "utf8");
  const events = parseRoomLog(raw).filter(e => e && typeof e === "object" && !Array.isArray(e));
  const malformed = raw.split("\n").filter(line => line.trim()).length - events.length;
  const metrics = runMetrics(events); // no git attribution, subprocesses or machine-clock measurements
  if (metrics.room !== room.name) { room.metricsError = "recorded log room mismatch"; continue; }
  room.metrics = metrics;
  if (malformed) room.metricsError = `${malformed} unreadable log line(s) were omitted; recovered metrics are partial`;
}
const feedback = runFeedback(run);
console.log(argv.includes("--json") ? JSON.stringify(feedback, null, 2) : renderFeedback(feedback));
