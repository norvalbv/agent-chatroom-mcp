/** What empty waits cost (telemetry gap G9: 51% of 5,872 waits returned nothing, "each one a paid model request", and no
 * record said what they cost). src/wait-cost.ts attributes each model request to the tool result that triggered it.
 * Run: npx tsx scripts/wait-cost-regression.ts
 */
import assert from "node:assert/strict";
import { emptyWaits, waitCost, renderWaitCost } from "../src/wait-cost.js";

const T0 = Date.parse("2026-10-11T10:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const usage = (room: string, s: number, requests: number, cost: number) => ({ type: "usage", room, seat: "ka", ts: at(s), usage: { requests, cost_usd: cost, at: at(s) } });
const call = (room: string, s: number, tool: string, empty?: boolean) => ({ type: "call_completion", room, tool, outcome: "success", participant: room === "leads" ? "p_lead" : "p_a", ts: at(s), ...(empty === undefined ? {} : { empty }) });
const group = [
  { type: "join", room: "g", p: { id: "p_a", name: "a", seatKeyHash: "ka" } },
  usage("g", 0, 1, 1),
  call("g", 60, "wait_for_messages", true), usage("g", 65, 2, 1.5),
  { type: "work", room: "g", pid: "p_a", cls: "run", tool: "Bash", target: "python3 x.py", ts: at(70) }, usage("g", 80, 3, 2.5),
  call("g", 140, "wait_for_messages", false), usage("g", 150, 4, 2.7),
  call("g", 160, "board_set"), usage("g", 170, 6, 3.7),
  usage("g", 200, 7, 4.0),
];
// the same seat process also sits in the leads room: its usage is in both logs, and its wait there triggered a request
const leads = [
  { type: "join", room: "leads", p: { id: "p_lead", name: "a", seatKeyHash: "ka" } },
  usage("leads", 0, 1, 1), usage("leads", 65, 2, 1.5), usage("leads", 80, 3, 2.5), usage("leads", 150, 4, 2.7), usage("leads", 170, 6, 3.7), usage("leads", 200, 7, 4.0),
  call("leads", 230, "wait_for_messages", true), usage("leads", 235, 8, 4.1),
];
const rows = waitCost([group, leads]);
const by = Object.fromEntries(rows.map((r) => [r.trigger, { requests: r.requests, cost_usd: r.cost_usd }]));
assert.deepEqual(by, {
  hub_call: { requests: 2, cost_usd: 1 },
  local_tool: { requests: 1, cost_usd: 1 },
  wait_empty: { requests: 2, cost_usd: 0.6 },
  no_tool_seen: { requests: 1, cost_usd: 0.3 },
  wait_msg: { requests: 1, cost_usd: 0.2 },
}, "each request once, though the seat's usage is in two room logs; the first sample has no earlier one to difference");
assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].cost_usd >= r.cost_usd), "largest first");
assert.match(renderWaitCost(rows), /\| wait_empty \| 2 \| \$0\.60 \| 19% \| \$0\.300 \|/);
const held = [{ type: "call_completion", tool: "wait_for_messages", participant: "p", empty: true, ms: 240_000 }, { type: "call_completion", tool: "wait_for_messages", participant: "p", empty: true, ms: 55_000 }, { type: "call_completion", tool: "wait_for_messages", participant: "p", empty: true, ms: 239_000 }, { type: "call_completion", tool: "wait_for_messages", participant: "p", empty: false, ms: 900 }];
assert.deepEqual(emptyWaits([held]), { waits: 4, empty: 3, median_empty_s: 239, empty_seat_minutes: 9 });
console.log("WAIT COST OK");
