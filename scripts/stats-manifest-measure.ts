/** Manifest bytes per wait, baseline-style full key list vs integrated deltas.
 * Run on either tree: npx tsx scripts/stats-manifest-measure.ts */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
Hub.DEFAULT_NUDGE_MS = 0;
const hub = new Hub();
const session = createSessionServer(hub);
const client = new Client({ name: "measure", version: "1" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await session.server.connect(st);
await client.connect(ct);
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  return JSON.parse((result.content as { text: string }[])[0].text);
};
try {
  await call("join_room", { room: "measure", name: "A", agent: "test" });
  // Second room so post_to_room can deliver the inbox/* entries (board_set cannot write them).
  await call("join_room", { room: "measure-feeder", name: "feeder", agent: "test" });
  // The lobby's shape: 132 flat entries.
  const groups: [string, number][] = [["evidence/", 48], ["claim/", 43], ["handoff/", 23], ["inbox/", 10], ["sources/", 4], ["verify/", 4]];
  for (const [prefix, n] of groups) {
    for (let i = 0; i < n; i++) {
      const text = prefix === "claim/" ? JSON.stringify({ area: `area-${i}`, owner: "bench", team: ["bench"], status: "open", note: "synthetic" }) : "payload ".repeat(10);
      if (prefix === "inbox/") {
        await call("post_to_room", { from_room: "measure-feeder", to_room: "measure", key: `note-${i}`, text: "payload ".repeat(10) });
      } else {
        await call("board_set", { room: "measure", key: `${prefix}entry-${i}`, text });
      }
    }
  }
  const perWait: number[] = [];
  for (let w = 1; w <= 10; w++) {
    if (w > 1 && w % 3 === 1) await call("board_set", { room: "measure", key: `evidence/churn-${w}`, text: "changed" });
    const r = await call("wait_for_messages", { room: "measure", timeout_ms: 0 });
    const envelope: Record<string, unknown> = {};
    for (const field of ["board_keys", "board_delta", "board_reset"]) if (field in r) envelope[field] = r[field];
    perWait.push(Object.keys(envelope).length ? Buffer.byteLength(JSON.stringify(envelope, null, 2), "utf8") : 0);
  }
  const total = perWait.reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ tree: process.env.MEASURE_TREE ?? "unknown", waits: perWait.length, per_wait_bytes: perWait, total_bytes: total, mean_bytes_per_wait: Math.round(total / perWait.length), max_wait_bytes: Math.max(...perWait) }));
} finally {
  await client.close();
  await session.server.close();
}
