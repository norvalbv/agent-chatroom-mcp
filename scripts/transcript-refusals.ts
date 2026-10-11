/**
 * What each seat of a run saw fail, from its transcript (src/transcript-failures.ts): hub refusals by family, and calls
 * that never reached the hub (client:*), which no room log records.
 *   npx tsx scripts/transcript-refusals.ts <swarms/<run>/result.json | transcript.jsonl>... [--json]
 * A result.json from a launcher with ef7c221e names each Claude seat's transcript; older ones name none.
 */
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { transcriptFailures, type FailureRow } from "../src/transcript-failures.js";

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
if (!files.length || files.some((f) => !statSync(f, { throwIfNoEntry: false })?.isFile())) {
  console.error("usage: transcript-refusals <result.json | transcript.jsonl>... [--json]");
  process.exit(2);
}
const seats: { seat: string; file?: string }[] = [];
for (const f of files) {
  if (f.endsWith(".json")) {
    const r = JSON.parse(readFileSync(f, "utf8")) as { scorecard?: { name: string; transcript?: string }[] };
    for (const s of r.scorecard ?? []) seats.push({ seat: s.name, ...(s.transcript ? { file: s.transcript } : {}) });
  } else seats.push({ seat: basename(f, ".jsonl"), file: f });
}
const rows: (FailureRow & { seat: string })[] = seats.flatMap((s) => (s.file ? transcriptFailures([s.file]).map((r) => ({ seat: s.seat, ...r })) : []));
if (argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  const withFile = seats.filter((s) => s.file).length;
  const client = rows.filter((r) => r.cls.startsWith("client:")).reduce((n, r) => n + r.n, 0);
  console.log(`${withFile} of ${seats.length} seats have a transcript; ${rows.reduce((n, r) => n + r.n, 0)} failed chatroom calls, ${client} of them never reached the hub (client:*).\n`);
  console.log("| seat | tool | class | calls |\n|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.seat} | ${r.tool} | ${r.cls} | ${r.n} |`);
}
