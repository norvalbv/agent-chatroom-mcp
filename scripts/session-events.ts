/**
 * What happened to the MCP sessions that held seats in a room: per seat, how often it moved to a newer connection, how
 * many sessions ended with the seat still served elsewhere (before the fix each of these threw the seat out), and how
 * many ended taking the seat with them, by reason.
 *   npx tsx scripts/session-events.ts <data/room.jsonl>... [--json]
 * A log from before the `session` event has none; its drops show only as "MCP session closed" leave reasons.
 */
import { readFileSync, statSync } from "node:fs";
import { parseRoomLog } from "../src/run-metrics.js";

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: session-events <room.jsonl>... [--json]");
  process.exit(2);
}
const rows = new Map<string, { room: string; seat: string; moved: number; closed_seat_kept: number; closed_seat_left: number; reasons: Record<string, number> }>();
for (const f of files) {
  if (!statSync(f, { throwIfNoEntry: false })?.isFile()) { console.error(`session-events: not a room log file: ${f}`); process.exit(2); }
  for (const e of parseRoomLog(readFileSync(f, "utf8"))) {
    if (e.type !== "session") continue;
    const k = `${e.room}|${e.name}`;
    const row = rows.get(k) ?? rows.set(k, { room: e.room, seat: e.name, moved: 0, closed_seat_kept: 0, closed_seat_left: 0, reasons: {} }).get(k)!;
    if (e.event === "moved") row.moved++;
    else if (e.seat_kept) row.closed_seat_kept++;
    else row.closed_seat_left++;
    if (e.event === "closed") row.reasons[e.reason] = (row.reasons[e.reason] ?? 0) + 1;
  }
}
const out = [...rows.values()];
if (argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log("| room | seat | moved to a newer session | sessions ended, seat kept | sessions ended, seat left | reasons |\n|---|---|---|---|---|---|");
  for (const r of out) console.log(`| ${r.room} | ${r.seat} | ${r.moved} | ${r.closed_seat_kept} | ${r.closed_seat_left} | ${Object.entries(r.reasons).map(([k, n]) => `${k} ×${n}`).join("; ") || "-"} |`);
  if (!out.length) console.log("| (no session events: a log from before them, or no session touched a seat) | | | | | |");
}
