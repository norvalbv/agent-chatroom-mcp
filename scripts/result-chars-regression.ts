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
import { steerAckSeat, steerPeekSeat } from "../src/hub/steer.js";
import { parseRoomLog } from "../src/run-metrics.js";
import { roomTraffic, trafficReread, trafficShare } from "../src/wait-cost.js";

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
  // an ask the seat's hook injects mid-turn reaches the context outside any hub call: it is logged as steer_injected
  const sb = createSessionServer(h), cb = new Client({ name: "b", version: "1" });
  const [ct2, st2] = InMemoryTransport.createLinkedPair();
  await sb.server.connect(st2); await cb.connect(ct2);
  await cb.callTool({ name: "join_room", arguments: { room, name: "b", agent: "claude" } });
  await cb.callTool({ name: "send_message", arguments: { room, content: "@a please check the fee model" } });
  const asks = steerPeekSeat(h, "key-a");
  assert.equal(asks.length, 1, "one ask pending for a");
  assert.equal(steerAckSeat(h, "key-a", asks.map((x) => x.id)), 1);

  const events = parseRoomLog(readFileSync(join(dir, `${room}.jsonl`), "utf8"));
  const done = events.filter((e) => e.type === "call_completion");
  const get = done.find((e) => e.tool === "board_get");
  const set = done.find((e) => e.tool === "board_set");
  assert.ok(get, "board_get recorded");
  assert.equal(get.result_chars, got, "board_get records the exact length of the text the model received");
  assert.ok(get.result_chars > 5000, "the entry's text is in the result");
  assert.ok(set, "board_set recorded");
  assert.ok(set.args_chars > 5000 && set.result_chars < 1000, "board_set: big arguments, small result");
  for (const e of done) assert.equal(typeof e.result_chars, "number", `${e.tool} records result_chars`);
  assert.ok(refused > 0);

  const t = roomTraffic([events]);
  const row = t.find((r) => r.tool === "board_get");
  assert.ok(row && row.calls === 1 && row.result_chars === got, "wait-cost sums result_chars per tool");
  // the denominator: new content only, a whole-context rewrite left out, samples in time order across two logs
  const ts = (s: number) => new Date(Date.UTC(2026, 9, 15, 10, 0, s)).toISOString();
  const u = (s: number, requests: number, write: number, read: number) => ({ type: "usage", seat: "k", ts: ts(s), usage: { requests, input_tokens: 0, cache_creation_input_tokens: write, cache_read_input_tokens: read, at: ts(s) } });
  const one = [u(1, 1, 10_000, 0), u(3, 3, 12_000, 30_000)], two = [u(2, 2, 11_000, 10_000), u(4, 4, 112_000, 30_000), u(3, 3, 12_000, 30_000)];
  const share = trafficShare([[...events.filter((e) => e.type === "call_completion")], ...[one, two]]);
  assert.equal(share.context_written_tokens, 12_000, "10k + 1k + 1k of new content, the same sample in two logs counted once");
  assert.equal(share.rewritten_tokens, 100_000, "a 100k write on one request that was most of what it sent is a rewrite");
  // a fresh process's first sample is its prompt and tool-schema prefix: new content, not a rewrite (review/f9001f7e)
  const fresh = trafficShare([[u(10, 2, 70_000, 0), u(20, 50, 120_000, 2_000_000)]]);
  assert.deepEqual([fresh.context_written_tokens, fresh.rewritten_tokens], [120_000, 0], "a process start is written, not rewritten");
  const injected = events.find((e) => e.type === "steer_injected");
  assert.ok(injected && injected.chars === asks[0].text.length && injected.asks === 1, "the injected text's size is logged");
  assert.equal(t.find((r) => r.tool.startsWith("(asks injected"))?.result_chars, asks[0].text.length, "and counted as room traffic");
  // re-read cost: a 400-char result at request 4 of a process that ends at request 10 is re-read 6 times
  const joined = { type: "join", p: { id: "p_k", seatKeyHash: "k" } };
  const r = (s: number, requests: number, read: number) => ({ type: "usage", seat: "k", ts: ts(s), usage: { requests, cache_read_input_tokens: read, at: ts(s) } });
  const reread = trafficReread([[joined, r(1, 4, 1000), { type: "call_completion", participant: "p_k", ts: ts(2), result_chars: 400 }, r(3, 10, 5000), r(4, 2, 300)]]);
  assert.equal(reread.hub_reread_tokens_est, 600);
  assert.equal(reread.cache_read_tokens, 5300, "a respawned process (counter down) counts from zero");
  // a result between process A's last sample and process B's first is not charged to every request of B (review/f9001f7e)
  const gap = trafficReread([[joined, r(1, 4, 1000), r(3, 10, 5000), { type: "call_completion", participant: "p_k", ts: ts(4), result_chars: 40_000 }, r(5, 2, 300), r(6, 105, 9000)]]);
  assert.equal(gap.hub_reread_tokens_est, 0, "a gap result is charged to neither process");
  console.log("result-chars regression: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
