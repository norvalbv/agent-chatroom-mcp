/** Offline replay using the SAME analyzer as hub.stats.
 * npx tsx scripts/reply-metrics.ts LOG.jsonl [--max-seq 707] [--reply-window-minutes 15]
 * A max-seq prefix never receives credit from later replies.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeReplyMetrics, parseReplyWindowMinutes } from "../src/reply-metrics.js";

try {
  const args = process.argv.slice(2);
  const source = args.shift();
  if (!source || source.startsWith("--")) throw new Error("Usage: reply-metrics.ts LOG.jsonl [--max-seq N] [--reply-window-minutes N]");
  let maxSeq: number | undefined;
  let windowMinutes = 15;
  let asOf: string | undefined;
  let observationEnd: string | undefined;
  while (args.length) {
    const option = args.shift();
    const value = args.shift();
    if (value === undefined) throw new Error(`Missing value for ${option}`);
    if (option === "--max-seq") {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("max-seq must be a nonnegative safe integer");
      maxSeq = Number(value);
    } else if (option === "--reply-window-minutes") windowMinutes = parseReplyWindowMinutes(value);
    else if (option === "--as-of" || option === "--observation-end") {
      if (!Number.isFinite(Date.parse(value))) throw new Error(`Invalid timestamp for ${option}`);
      if (option === "--as-of") asOf = new Date(value).toISOString();
      else observationEnd = new Date(value).toISOString();
    } else throw new Error(`Unknown option: ${option}`);
  }
  const path = resolve(source);
  const events = readFileSync(path, "utf8").split("\n").filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on line ${index + 1}`); }
  });
  const metrics = analyzeReplyMetrics(events, { windowMinutes, maxSeq, asOf, observationEnd });
  console.log(JSON.stringify({ parser: "persisted-routing-pairs-v1", source_path: path, max_seq: maxSeq ?? null,
    observation_cutoff: metrics.observation_end, reply_metrics: metrics }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
