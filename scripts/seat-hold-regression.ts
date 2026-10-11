/** A launched Claude seat's connection holds an empty wait for minutes, not 55 s (claim/empty-waits; pack item 7 polling).
 * scripts/wait-cost.ts over the last 21 room logs: empty waits triggered 2,050 model requests costing $163.62 of
 * $1,427.97 (12%; 22% in the grouped Polymarket run), $0.08 each, because a wait returns empty after MAX_WAIT_MS, a cap
 * set for Codex's 60 s client timeout. The launcher now tells the hub, in the seat's MCP URL, how long that seat's
 * client will wait for a tool (?hold=<ms>, with MCP_TOOL_TIMEOUT to match), and the hub holds a full-length wait that long.
 * Run: npx tsx scripts/seat-hold-regression.ts   (in-process sessions; no port)
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { MAX_SEAT_HOLD_MS, holdFromQuery, seatBeat, seatHoldMs } from "../src/env.js";

Hub.DEFAULT_NUDGE_MS = 0;

// ---------- the launcher's side ----------
assert.equal(seatHoldMs(undefined), MAX_SEAT_HOLD_MS, "on by default");
assert.equal(MAX_SEAT_HOLD_MS, 240_000, "four minutes: gaps of 240-360 s between a seat's requests still hit the prompt cache in the records (1 miss in 45)");
assert.equal(seatHoldMs("0"), undefined, "CHATROOM_SEAT_HOLD_MS=0 turns it off");
assert.equal(seatHoldMs("120000"), 120_000);
assert.equal(seatHoldMs("9999999"), MAX_SEAT_HOLD_MS, "never past the cap");
assert.equal(seatHoldMs("nonsense"), MAX_SEAT_HOLD_MS);
const plain = seatBeat("http://127.0.0.1:1/mcp", "key-12345678");
assert.equal(new URL(plain.mcpUrl).searchParams.get("hold"), null, "a seat whose client timeout the launcher does not set (codex) asks for no hold");
assert.equal(plain.env.MCP_TOOL_TIMEOUT, undefined);
const held = seatBeat("http://127.0.0.1:1/mcp", "key-12345678", undefined, 240_000);
assert.equal(new URL(held.mcpUrl).searchParams.get("hold"), "240000");
assert.equal(held.env.MCP_TOOL_TIMEOUT, "300000", "the seat's client waits a minute longer than the hub holds");

// ---------- the hub's side ----------
assert.equal(holdFromQuery("240000"), 240_000);
assert.equal(holdFromQuery("99999999"), MAX_SEAT_HOLD_MS, "a client cannot ask the hub to hold a request for an hour");
assert.equal(holdFromQuery("1000"), undefined, "below a normal wait it is not a hold");
assert.equal(holdFromQuery(undefined), undefined);
assert.equal(holdFromQuery(["240000"]), undefined);

const hub = new Hub({});
const open: Client[] = [];
async function seat(name: string, holdMs?: number) {
  const session = createSessionServer(hub, undefined, { holdMs });
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st);
  await client.connect(ct);
  open.push(client);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name: tool, arguments: { room: "hold", ...args } })) as { isError?: boolean; content: { text: string }[] };
    assert.notEqual(r.isError, true, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  await call("join_room", { name, agent: "claude" });
  return call;
}
const timed = async <T>(run: () => Promise<T>) => { const t = Date.now(); const out = await run(); return { ms: Date.now() - t, out }; };
try {
  // the hold is whatever the connection declared: 1.5 s here, so the test does not take four minutes
  const a = await seat("held", 1500);
  const b = await seat("plain");
  await a("wait_for_messages", { timeout_ms: 0 });
  await b("wait_for_messages", { timeout_ms: 0 });

  const full = await timed(() => a("wait_for_messages", { timeout_ms: 55_000 }));
  assert.ok(full.ms >= 1400 && full.ms < 5000, `a full-length wait on a held connection returns when the hold ends, not at 55 s (${full.ms} ms)`);
  assert.deepEqual(full.out.messages, []);
  const omitted = await timed(() => a("wait_for_messages", {}));
  assert.ok(omitted.ms >= 1400 && omitted.ms < 5000, `the default wait is a full-length wait (${omitted.ms} ms)`);
  const short = await timed(() => a("wait_for_messages", { timeout_ms: 200 }));
  assert.ok(short.ms < 1000, `a short poll the seat asked for is left alone (${short.ms} ms)`);
  const unheld = await timed(() => b("wait_for_messages", { timeout_ms: 300 }));
  assert.ok(unheld.ms < 1000, `a connection with no hold is unchanged (${unheld.ms} ms)`);

  // a held wait still wakes at once for a message
  const waiting = timed(() => a("wait_for_messages", { timeout_ms: 55_000 }));
  await new Promise((r) => setTimeout(r, 200));
  await b("send_message", { content: "@held the scorer has finished", force: true });
  const woke = await waiting;
  assert.ok(woke.ms < 1200, `woken by the message, not by the hold ending (${woke.ms} ms)`);
  assert.equal(woke.out.messages.length, 1);
  console.log("seat-hold-regression OK");
} finally {
  for (const c of open) await c.close().catch(() => {});
}
