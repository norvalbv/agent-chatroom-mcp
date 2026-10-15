/**
 * Every hub call records how much text it put into the caller's context. A seat re-reads its whole context on every
 * model request, so what the hub returns is paid for again on each later request until the seat compacts; the room
 * records said which tool a seat called and how long it took, never how big the answer was, so no record could say how
 * much of a seat's context was room traffic rather than its own work (the room's open question in swarm-092526-89rn).
 * call_completion now carries result_chars (the text the model receives, refusals included) and args_chars (what the
 * seat wrote into the call), and src/wait-cost.ts sums them per tool.
 * Run: npx tsx scripts/result-chars-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { parseRoomLog } from "../src/run-metrics.js";
import { roomTraffic } from "../src/wait-cost.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dir = mkdtempSync(join(tmpdir(), "result-chars-"));
try {
  const h = new Hub({ dataDir: dir });
  const session = createSessionServer(h);
  h.bindSeat("key-a", session.sessionKey);
  const client = new Client({ name: "a", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    return (r.content as { text: string }[]).map((c) => c.text).join("").length;
  };
  const room = "result-chars";
  await call("join_room", { room, name: "a", agent: "claude", topic: "t" });
  const big = "x".repeat(5000);
  await call("board_set", { room, key: "notes", text: big });
  const got = await call("board_get", { room, key: "notes" });
  const refused = await call("board_get", { room: "no-such-room", key: "notes" });

  const events = parseRoomLog(readFileSync(join(dir, `${room}.jsonl`), "utf8"));
  const done = events.filter((e) => e.type === "call_completion");
  const get = done.find((e) => e.tool === "board_get");
  const set = done.find((e) => e.tool === "board_set");
  assert.ok(get, "board_get recorded");
  assert.equal(get.result_chars, got, "board_get records the exact length of the text the model received");
  assert.ok(get.result_chars > 5000, "the entry's text is in the result");
  assert.ok(set.args_chars > 5000 && set.result_chars < 1000, "board_set: big arguments, small result");
  for (const e of done) assert.equal(typeof e.result_chars, "number", `${e.tool} records result_chars`);
  assert.ok(refused > 0);

  const t = roomTraffic([events]);
  const row = t.find((r) => r.tool === "board_get");
  assert.ok(row && row.calls === 1 && row.result_chars === got, "wait-cost sums result_chars per tool");
  console.log("result-chars regression: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
