/** With no memory budget set, a seat's processes passing a mark are still recorded and the seat told (telemetry gap
 * G11: on hub 7717 budget_mb was null, so no warn fired while four seats peaked at 2.5-3.5 GB in 1nwp and 079m; this
 * room's own brief caps a process at 2 GB). Nothing is stopped without a budget. Run: npx tsx scripts/memory-high-regression.ts */
import assert from "node:assert/strict";
import { MemoryWatch, memoryNotice, parseTable, type MemoryEvent } from "../src/hub/memory.js";

const row = (pid: number, kb: number, cmd: string) => `  ${pid}     1 ${kb}    10:00 ${cmd}`;
const env = (pids: number[]) => pids.map((p) => `${p} x CHATROOM_SEAT_KEY=seat-key-AAAA`).join("\n");
const ticks = [
  [row(100, 300_000, "claude -p brief"), row(101, 1_500_000, "python3 load.py")], // 1.4 GB: under the mark
  [row(100, 300_000, "claude -p brief"), row(101, 2_600_000, "python3 load.py")], // 2.5 GB: over
  [row(100, 300_000, "claude -p brief"), row(101, 2_900_000, "python3 load.py")], // still over: no second event
  [row(100, 300_000, "claude -p brief"), row(101, 400_000, "python3 load.py")],   // back under half: re-armed
  [row(100, 300_000, "claude -p brief"), row(101, 2_700_000, "python3 load.py")], // over again: a new event
];
const events: MemoryEvent[] = [];
let i = 0, killed = 0;
const watch = new MemoryWatch({
  watched: () => true,
  table: async () => parseTable(ticks[i].join("\n"), env([100, 101])),
  footprints: async () => new Map(),
  onEvent: (e) => events.push(e),
  kill: () => { killed++; },
});
assert.equal(watch.budgetMb, null, "no budget: the hub enforces nothing");
for (; i < ticks.length; i++) await watch.tick();
assert.deepEqual(events.map((e) => [e.kind, e.mb]), [["high", 2539], ["high", 2637]], "one 'high' event per crossing of the 2,000 MB mark");
assert.equal(killed, 0, "nothing is stopped without a budget");
const e = events[0] as Extract<MemoryEvent, { kind: "high" }>;
assert.equal(e.mark_mb, 2000);
assert.equal(e.top.pid, 101);
const text = memoryNotice(e);
assert.match(text, /^MEMORY: the processes you started hold 2539 MB, past 2000 MB\. Largest: pid 101 \(2539 MB\): python3 load\.py\. No budget is enforced on this hub, so nothing will be stopped/);
assert.match(text, /read it in chunks or as a stream/);
// the record: run-metrics counts them per seat
const { runMetrics } = await import("../src/run-metrics.js");
const m = runMetrics([
  { type: "join", room: "r", p: { id: "p_a", name: "a", agent: "claude", joinedAt: "2026-10-11T10:00:00Z", seatKeyHash: "ka" } },
  { type: "memory", room: "r", seat: "ka", event: "high", mb: 2539, mark_mb: 2000, top: e.top, ts: "2026-10-11T10:05:00Z" },
]);
assert.equal(m.seats.find((s) => s.name === "a")?.memory?.highs, 1);
assert.equal(m.seats.find((s) => s.name === "a")?.memory?.peak_mb, 2539);
console.log("memory-high-regression OK");
