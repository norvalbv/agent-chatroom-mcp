/**
 * Replay real room_status results through src/hub/status-view.ts: bytes as recorded, as main serialises them today
 * (compact JSON, be4982ed), and after statusView. Reads Codex *.events.jsonl (mcp_tool_call items).
 * Run: npx tsx scripts/room-status-replay.ts swarms/swarm-205033-6bp8/*.events.jsonl
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { statusView } from "../src/hub/status-view.js";

const rows: { file: string; recorded: number; compact: number; after: number }[] = [];
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let e: { type?: string; item?: { type?: string; tool?: string; result?: { content?: { text?: string }[] } } };
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "item.completed" || e.item?.type !== "mcp_tool_call" || e.item.tool !== "room_status") continue;
    const text = (e.item.result?.content ?? []).map((c) => c.text ?? "").join("");
    let data: Record<string, unknown>;
    try { data = JSON.parse(text); } catch { continue; }
    const bytes = (s: string) => Buffer.byteLength(s, "utf8");
    rows.push({ file: basename(file), recorded: bytes(text), compact: bytes(JSON.stringify(data)), after: bytes(JSON.stringify(statusView(data))) });
  }
}
const sum = (k: "recorded" | "compact" | "after") => rows.reduce((n, r) => n + r[k], 0);
for (const r of rows) console.log(`${r.file}\t${r.recorded}\t${r.compact}\t${r.after}`);
const [rec, comp, after] = [sum("recorded"), sum("compact"), sum("after")];
console.log(`calls ${rows.length}\trecorded ${rec} B\tcompact ${comp} B\tafter ${after} B\t(${((after / comp - 1) * 100).toFixed(1)}% vs compact, ${((after / rec - 1) * 100).toFixed(1)}% vs recorded)`);
