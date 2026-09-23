/**
 * swarm-083203-kooz (backlog/friction-claude-opus-5-5-1 item 3): the hub's reviewer-assignment notice
 * (a system-authored chat line that @-names the reviewer) was treated as an owed reply. Nobody can
 * reply_to the hub, so until the reviewer called pass every wait_for_messages and read_messages returned
 * only that one notice (the room's chat stayed queued behind it) and send_message refused with
 * "1 message(s) arrived while you were composing". In a 15-seat room nearly every seat is a reviewer.
 * A hub notice is now retired once delivered; an agent's @-ask is still owed exactly as before, and the
 * notice still wakes a held wait (covered live in reviewer-assignment-regression.ts).
 * Run: npx tsx scripts/hub-notice-not-debt-regression.ts
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

let serial = 0;
function reviewed() {
  const h = new Hub();
  const name = `hub-notice-${++serial}`;
  const { room, participant: owner } = h.join(name, "owner", "test");
  const { participant: bob } = h.join(name, "bob", "test");
  const { participant: carol } = h.join(name, "carol", "test");
  const entry = h.setBoard(name, owner.id, "claim/x", JSON.stringify({ area: "x", owner: "owner", status: "open" }))!;
  assert.equal(entry.reviewer, "bob");
  return { h, room, owner, bob, carol };
}

test("the reviewer notice is delivered once, then the room's chat reaches the reviewer's next wait", async () => {
  const { h, room, bob, carol } = reviewed();
  const first = await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
  assert.ok(first.some((m) => /you are the reviewer/.test(m.content)), "the notice itself is delivered");
  h.send(room.name, carol.id, "carol: evidence is on the board", undefined, true);
  const second = await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
  assert.ok(second.some((m) => /carol: evidence/.test(m.content)), `carol's message reaches bob; got ${JSON.stringify(second.map((m) => m.content))}`);
  assert.ok(!second.some((m) => /you are the reviewer/.test(m.content)), "the notice is not re-delivered");
});

test("send_message is not refused by an already-delivered hub notice", async () => {
  const { h, room, bob } = reviewed();
  await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
  assert.doesNotThrow(() => h.send(room.name, bob.id, "bob: starting the review"));
  assert.equal(h.attentionFocus(room, bob), undefined, "no focused ask remains");
});

test("an agent's @-ask is still owed: it stays focused and blocks an unrelated send until answered", async () => {
  const { h, room, bob, carol } = reviewed();
  await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
  const ask = h.send(room.name, carol.id, "@bob which commit should I test?", undefined, true);
  await h.wait(room.name, bob.id, bob.lastSeenSeq, 0);
  assert.equal(h.attentionFocus(room, bob)?.id, ask.id);
  assert.throws(() => h.send(room.name, bob.id, "something unrelated"), /arrived while you were composing/);
  assert.doesNotThrow(() => h.send(room.name, bob.id, "abc1234", ask.id));
});

test("over MCP: read_messages delivers the notice once, then send_message goes through without force", async () => {
  const hub = new Hub();
  const sessions = ["owner", "bob"].map(() => createSessionServer(hub));
  const clients = await Promise.all(sessions.map(async (s, i) => {
    const c = new Client({ name: `c${i}`, version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await s.server.connect(st);
    await c.connect(ct);
    return c;
  }));
  const call = (c: Client) => async (name: string, args: Record<string, unknown>) => {
    const r = await c.callTool({ name, arguments: args });
    return { error: !!r.isError, body: (r.content as { text: string }[])[0].text };
  };
  const [asOwner, asBob] = clients.map(call);
  const room = "hub-notice-mcp";
  await asOwner("join_room", { room, name: "owner", agent: "test" });
  await asBob("join_room", { room, name: "bob", agent: "test" });
  await asOwner("board_set", { room, key: "claim/y", text: JSON.stringify({ area: "y", owner: "owner", status: "open" }) });
  const read = await asBob("read_messages", { room });
  assert.match(read.body, /you are the reviewer/);
  const sent = await asBob("send_message", { room, content: "on it" });
  assert.ok(!sent.error, sent.body);
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
console.log(`HUB NOTICE NOT DEBT: ${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
