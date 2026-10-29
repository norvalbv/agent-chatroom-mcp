/** npx tsx scripts/delivery-receipts.ts <room.jsonl> [...] [--json] */
import { readFileSync } from "node:fs";
import { parseLog } from "../src/measurements/winner-provenance.js";
import { deliveryCoverage } from "../src/measurements/delivery-receipts.js";

const args = process.argv.slice(2), files = args.filter(a => a !== "--json");
if (!files.length) throw new Error("usage: delivery-receipts <room.jsonl> [...] [--json]");
const rows = files.map(file => {
  const { events, malformed } = parseLog(readFileSync(file, "utf8"));
  return { file, malformed, ...deliveryCoverage(events) };
});
if (args.includes("--json")) console.log(JSON.stringify({ rows }, null, 2));
else for (const row of rows) console.log(`${row.file}: ${row.covered}/${row.n} prior receipts; unknown=${row.unknown}; bytes/message=${row.receipt_bytes_per_message?.toFixed(2) ?? "unknown"}; ${row.unknown_reason ?? "causality unproven"}`);
