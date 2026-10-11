/**
 * Regression: a room's stats say who called its tools without holding a seat in it.
 * Run: npx tsx scripts/outside-calls-regression.ts
 *
 * Gap (swarm-003601-tky5, findings/hub-today A): a connection with no seat in a room can board_get, read_messages and
 * room_status it. Those calls were already in the record as call_completion with participant null, which says an
 * outsider read the room and not which seat it was, so "did the build group read the break group's room" could only be
 * inferred. The event now carries the caller's seats elsewhere (name@room), and stats count them per caller and tool.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

const BUILD = "swarm-000004-outs-build";
const BREAK = "swarm-000004-outs-break";

async function connect(hub: Hub) {
  const session = createSessionServer(hub);
  const client = new Client({ name: "t", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st);
  await client.connect(ct);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    try { return JSON.parse(text); } catch { return text; }
  };
}

test("calls from a connection with no seat in the room are counted under its seats elsewhere", async () => {
  const dir = mkdtempSync(join(tmpdir(), "outside-calls-"));
  try {
    const hub = new Hub({ dataDir: dir });
    const builder = await connect(hub), breaker = await connect(hub), nobody = await connect(hub);
    await builder("join_room", { room: BUILD, name: "build-1", agent: "test" });
    await breaker("join_room", { room: BREAK, name: "break-1", agent: "test" });
    await builder("board_set", { room: BUILD, key: "findings/build-1", text: "reward model v2" });
    // the builder reads its own room: a member's call, never counted
    await builder("board_get", { room: BUILD, key: "findings/build-1" });
    await builder("room_status", { room: BUILD });
    assert.deepEqual((hub.stats(hub.getRoom(BUILD)) as { outside_calls?: unknown }).outside_calls, {});
    // the breaker reads the build group's room twice and its log once; a connection with no seat anywhere looks once
    await breaker("board_get", { room: BUILD, key: "findings/build-1" });
    await breaker("board_get", { room: BUILD });
    await breaker("read_messages", { room: BUILD, since_seq: 0 });
    await nobody("room_status", { room: BUILD });
    assert.deepEqual((hub.stats(hub.getRoom(BUILD)) as { outside_calls?: unknown }).outside_calls, {
      "break-1@swarm-000004-outs-break: board_get": 2,
      "break-1@swarm-000004-outs-break: read_messages": 1,
      "(no seat): room_status": 1,
    });
    assert.deepEqual((hub.stats(hub.getRoom(BREAK)) as { outside_calls?: unknown }).outside_calls, {}, "the breaker's own room counts nothing");
    // the record carries it, and a restarted hub counts the same
    const events = readFileSync(join(dir, `${BUILD}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; tool?: string; outsider?: string });
    assert.equal(events.filter((e) => e.type === "call_completion" && e.outsider === "break-1@swarm-000004-outs-break").length, 3);
    const again = new Hub({ dataDir: dir });
    assert.deepEqual((again.stats(again.getRoom(BUILD)) as { outside_calls?: unknown }).outside_calls, (hub.stats(hub.getRoom(BUILD)) as { outside_calls?: unknown }).outside_calls);
    // joining is how a seat becomes a member: neither the join nor what it does afterwards is an outside call
    await breaker("join_room", { room: BUILD, name: "break-1", agent: "test" });
    await breaker("board_get", { room: BUILD });
    assert.equal(Object.values((hub.stats(hub.getRoom(BUILD)) as { outside_calls: Record<string, number> }).outside_calls).reduce((a, n) => a + n, 0), 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
