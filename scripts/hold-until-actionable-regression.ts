/**
 * Item 1b (swarm-084605-6m31): wait_for_messages(hold_until_actionable=true) must hold through
 * plain chatter and only return once something actionable arrives (or timeout_ms elapses),
 * without dropping any message and without changing default (opt-out) behaviour.
 * Run: npx tsx scripts/hold-until-actionable-regression.ts
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

const cases: [string, () => Promise<void> | void][] = [];
function test(name: string, run: () => Promise<void> | void) {
  cases.push([name, run]);
}

// ---------- unit: Hub.actionableNow ----------

let serial = 0;
function fixture() {
  const h = new Hub();
  const name = `hold-actionable-${++serial}`;
  const { room, participant: alice } = h.join(name, "alice", "test");
  const { participant: bob } = h.join(name, "bob", "test");
  return { h, room, name, alice, bob };
}

test("actionableNow: false on a fresh room", () => {
  const { h, room, bob } = fixture();
  assert.equal(h.actionableNow(room, bob), false);
});

test("actionableNow: false on unaddressed chatter", () => {
  const { h, room, alice, bob } = fixture();
  h.send(room.name, alice.id, "just fyi, nothing for you", undefined, true);
  assert.equal(h.actionableNow(room, bob), false);
});

test("actionableNow: true once addressed", () => {
  const { h, room, alice, bob } = fixture();
  h.send(room.name, alice.id, "@bob please look at this", undefined, true);
  assert.equal(h.actionableNow(room, bob), true);
});

test("actionableNow: true when a vote is owed on the open proposal", () => {
  const { h, room, alice, bob } = fixture();
  h.propose(room.name, alice.id, "Adopt the plan as written, no changes needed here.");
  assert.equal(h.actionableNow(room, bob), true);
});

test("actionableNow: true on an unanswered human message, even for a bystander", () => {
  const { h, room, alice, bob } = fixture();
  const { participant: carol } = h.join(room.name, "carol", "test");
  const { participant: dave } = h.join(room.name, "dave", "human");
  h.send(room.name, dave.id, "can someone confirm status", undefined, true);
  assert.equal(h.actionableNow(room, bob), true, "nominated responder");
  assert.equal(h.actionableNow(room, carol), true, "bystander still told a human spoke");
  void alice;
});

test("actionableNow: true once the room concludes or closes", () => {
  const { h, room, bob } = fixture();
  room.state = "concluded";
  assert.equal(h.actionableNow(room, bob), true);
  room.state = "closed";
  assert.equal(h.actionableNow(room, bob), true);
});

// ---------- integration: wait_for_messages(hold_until_actionable) over the real MCP tool ----------
// Each participant needs its own MCP connection (a room tool call is scoped to the caller's
// session), so alice and bob get separate client/session pairs wired with InMemoryTransport.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("hold_until_actionable: bob's wait survives chatter and wakes on @bob, all messages intact", async () => {
  const hub = new Hub();
  const aliceSession = createSessionServer(hub);
  const bobSession = createSessionServer(hub);
  const aliceClient = new Client({ name: "alice", version: "1" });
  const bobClient = new Client({ name: "bob", version: "1" });
  const [act, ast] = InMemoryTransport.createLinkedPair();
  const [bct, bst] = InMemoryTransport.createLinkedPair();
  await aliceSession.server.connect(ast);
  await aliceClient.connect(act);
  await bobSession.server.connect(bst);
  await bobClient.connect(bct);
  const callAs = (client: Client) => async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse((r.content as { text: string }[])[0].text);
  };
  const asAlice = callAs(aliceClient);
  const asBob = callAs(bobClient);

  const room = "hold-wake-2conn";
  await asAlice("join_room", { room, name: "alice", agent: "test" });
  await asBob("join_room", { room, name: "bob", agent: "test" });

  const started = Date.now();
  const pending = asBob("wait_for_messages", { room, hold_until_actionable: true, timeout_ms: 2000 });
  await sleep(30);
  await asAlice("send_message", { room, content: "chatter that is not for bob", force: true });
  await sleep(30);
  await asAlice("send_message", { room, content: "more chatter", force: true });
  await sleep(30);
  await asAlice("send_message", { room, content: "@bob now please respond", force: true });

  const result = await pending;
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1500, `held past its wake: took ${elapsed}ms (timeout was 2000ms)`);
  assert.equal(result.messages.length, 3, "no message dropped across the held poll");
  assert.match(result.messages[2], /@bob now please respond/);
  assert.match(result.hint, /addressed you directly/);
});

test("hold_until_actionable: returns by the deadline when nothing ever becomes actionable, keeping the chatter", async () => {
  const hub = new Hub();
  const aliceSession = createSessionServer(hub);
  const bobSession = createSessionServer(hub);
  const aliceClient = new Client({ name: "alice2", version: "1" });
  const bobClient = new Client({ name: "bob2", version: "1" });
  const [act, ast] = InMemoryTransport.createLinkedPair();
  const [bct, bst] = InMemoryTransport.createLinkedPair();
  await aliceSession.server.connect(ast);
  await aliceClient.connect(act);
  await bobSession.server.connect(bst);
  await bobClient.connect(bct);
  const callAs = (client: Client) => async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse((r.content as { text: string }[])[0].text);
  };
  const asAlice = callAs(aliceClient);
  const asBob = callAs(bobClient);

  const room = "hold-timeout";
  await asAlice("join_room", { room, name: "alice", agent: "test" });
  await asBob("join_room", { room, name: "bob", agent: "test" });

  const started = Date.now();
  const pending = asBob("wait_for_messages", { room, hold_until_actionable: true, timeout_ms: 300 });
  await sleep(30);
  await asAlice("send_message", { room, content: "chatter with no addressee", force: true });

  const result = await pending;
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 290, `must not return before the deadline just because chatter arrived: took ${elapsed}ms`);
  assert.equal(result.messages.length, 1, "the chatter must still be delivered, not lost, once holding stops");
});

test("without hold_until_actionable, behaviour is unchanged: returns immediately on plain chatter", async () => {
  const hub = new Hub();
  const aliceSession = createSessionServer(hub);
  const bobSession = createSessionServer(hub);
  const aliceClient = new Client({ name: "alice3", version: "1" });
  const bobClient = new Client({ name: "bob3", version: "1" });
  const [act, ast] = InMemoryTransport.createLinkedPair();
  const [bct, bst] = InMemoryTransport.createLinkedPair();
  await aliceSession.server.connect(ast);
  await aliceClient.connect(act);
  await bobSession.server.connect(bst);
  await bobClient.connect(bct);
  const callAs = (client: Client) => async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse((r.content as { text: string }[])[0].text);
  };
  const asAlice = callAs(aliceClient);
  const asBob = callAs(bobClient);

  const room = "no-hold-default";
  await asAlice("join_room", { room, name: "alice", agent: "test" });
  await asBob("join_room", { room, name: "bob", agent: "test" });

  const started = Date.now();
  const pending = asBob("wait_for_messages", { room, timeout_ms: 2000 });
  await sleep(30);
  await asAlice("send_message", { room, content: "plain chatter", force: true });

  const result = await pending;
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 500, `default (opt-out) behaviour must still return on any message: took ${elapsed}ms`);
  assert.equal(result.messages.length, 1);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`);
  }
}
console.log(`HOLD UNTIL ACTIONABLE: ${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
