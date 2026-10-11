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
import { idlePolicy, leaveWaitsFor, offersLeave } from "../src/hub/open-work.js";

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

// the idle-leave offer counts waits; on a held connection the same eight minutes of nothing is two waits, not eight
assert.equal(leaveWaitsFor(undefined), idlePolicy.leaveWaits, "a plain connection: unchanged");
assert.equal(leaveWaitsFor(240_000), 2, "8 waits of 55 s is about 7 min: two 4-minute waits");
assert.equal(leaveWaitsFor(120_000), 4);
{
  const h = new Hub({});
  const a = h.join("leave", "a", "claude", { requireChallenge: false, expectedParticipants: 0 }, undefined, "s-a").participant;
  h.join("leave", "b", "claude", {}, undefined, "s-b");
  const room = h.getRoom("leave");
  assert.equal(offersLeave(room, a, 2, []), false, "after two waits a plain connection is not offered the door");
  assert.equal(offersLeave(room, a, 2, [], leaveWaitsFor(240_000)), true, "a held one is: it has waited as long");
  assert.equal(offersLeave(room, a, 3, [], leaveWaitsFor(240_000)), false, "and again only every second wait");
}

const hub = new Hub({});
const open: Client[] = [];
async function seat(name: string, holdMs?: number, fullWaitMs?: number) {
  const session = createSessionServer(hub, undefined, { holdMs, ...(fullWaitMs ? { fullWaitMs } : {}) });
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
  // evidence/held-wait-misses-challenge (claude-opus-5-5-1's A/B on integration): a proposer in a hold_until_actionable
  // wait sat 172-188 s after two challenges on its own proposal, because a challenge is not "actionable" for it and the
  // hold had stretched the time chatter is skipped from the seat's own 55 s to 4 min. Scaled down: a "full-length" wait
  // here is 1 s (fullWaitMs), the hold 4 s. Silence is held 4 s; a message that is not addressed to the seat ends the
  // wait once its own 1 s has passed, not at 4 s.
  {
    const c = await seat("held-chatter", 4000, 1000);
    await c("wait_for_messages", { timeout_ms: 0 });
    const quiet = await timed(() => c("wait_for_messages", { timeout_ms: 1000, hold_until_actionable: true }));
    assert.ok(quiet.ms >= 3800, `silence is still held to the hold (${quiet.ms} ms)`);
    const run = timed(() => c("wait_for_messages", { timeout_ms: 1000, hold_until_actionable: true }));
    await new Promise((r) => setTimeout(r, 300));
    await b("send_message", { content: "an aside nobody has to answer", force: true });
    const got = await run;
    assert.ok(got.ms >= 900 && got.ms < 2000, `chatter is skipped for the seat's own budget only, then returned (${got.ms} ms, not 4000)`);
    assert.equal(got.out.messages.length, 1);
    // and a message after that budget is returned at once, not held to the end of the hold
    const late = timed(() => c("wait_for_messages", { timeout_ms: 1000, hold_until_actionable: true }));
    await new Promise((r) => setTimeout(r, 1800));
    const t = Date.now();
    await b("send_message", { content: "another aside", force: true });
    const got2 = await late;
    assert.ok(Date.now() - t < 500, `a message after the seat's own budget returns the held wait at once (${Date.now() - t} ms after it)`);
    assert.equal(got2.out.messages.length, 1);
  }
  console.log("seat-hold-regression OK");
} finally {
  for (const c of open) await c.close().catch(() => {});
}
