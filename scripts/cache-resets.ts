/**
 * Cache resets across every room of a run (src/metrics/cache-reset.ts): the moments most live seats rewrote their whole context
 * at once, with their tokens and $. One credential switch hits every room on the machine, so pass all of a run's logs.
 * Streams the logs, keeping only usage events.
 *   npx tsx scripts/cache-resets.ts <data/room.jsonl>... [--json]
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { cacheResets, renderCacheResets } from "../src/metrics/cache-reset.js";

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: cache-resets <room.jsonl>... [--json]");
  process.exit(2);
}
const events: Record<string, any>[] = [];
for (const f of files) for await (const line of createInterface({ input: createReadStream(f) })) if (line.includes('"type":"usage"')) events.push(JSON.parse(line));
const at = (e: Record<string, any>) => Date.parse(e.usage?.at ?? e.ts ?? "");
events.sort((a, b) => at(a) - at(b));
const r = cacheResets(events);
console.log(argv.includes("--json") ? JSON.stringify(r, null, 2) : renderCacheResets(r));
