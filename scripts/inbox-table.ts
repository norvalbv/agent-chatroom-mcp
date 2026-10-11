/**
 * One row per room record about the notes it was sent: how many, how fast and how they were acknowledged, what the cap
 * refused, and how long the room's inbox was full under the old rule (every note counts) and the current one
 * (ack-required notes only). Rooms that were sent nothing are left out.
 *   npx tsx scripts/inbox-table.ts <data/room.jsonl>... [--json]
 */
import { readFileSync, statSync } from "node:fs";
import { parseRoomLog } from "../src/run-metrics.js";
import { inboxRow, renderInboxTable, type InboxRow } from "../src/inbox-table.js";

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: inbox-table <room.jsonl>... [--json]");
  process.exit(2);
}
const rows: InboxRow[] = [];
for (const f of files) {
  if (!statSync(f).isFile()) { console.error(`skipped ${f}: not a file`); continue; }
  const events = parseRoomLog(readFileSync(f, "utf8"));
  if (!events.some((e) => e.type === "room")) continue;
  const row = inboxRow(events);
  if (row.notes || row.refused) rows.push(row);
}
console.log(argv.includes("--json") ? JSON.stringify(rows, null, 2) : renderInboxTable(rows));
