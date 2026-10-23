/**
 * The escalation benchmark's scorer (src/metrics/escalation-metrics.ts): per room log, whether it measured its environment
 * before experimenting, minutes from the first evidence of a blocking constraint to a needs/hold entry or a question
 * to the owner, step-ins by the chair or a human, and cost.
 *   npx tsx scripts/escalation-bench.ts <data/room.jsonl>... [--evidence-seq N] [--json]
 */
import { readFileSync } from "node:fs";
import { escalationMetrics, renderEscalation } from "../src/metrics/escalation-metrics.js";
import { parseRoomLog } from "../src/run-metrics.js";

const argv = process.argv.slice(2);
const seqAt = argv.indexOf("--evidence-seq");
const evidenceSeq = seqAt >= 0 ? Number(argv[seqAt + 1]) : undefined;
const files = argv.filter((a, i) => !a.startsWith("--") && !(seqAt >= 0 && i === seqAt + 1));
if (!files.length) {
  console.error("usage: escalation-bench <room.jsonl>... [--evidence-seq N] [--json]");
  process.exit(2);
}
const rows = files.map((f) => escalationMetrics(parseRoomLog(readFileSync(f, "utf8")), { evidenceSeq }));
console.log(argv.includes("--json") ? JSON.stringify(rows, null, 2) : rows.map(renderEscalation).join("\n"));
