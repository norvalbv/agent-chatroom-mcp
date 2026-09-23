/**
 * swarm-092653-202z (salvaged from hdju claim/per-turn-payload, never built): bytes every seat re-reads
 * on every turn that carry nothing new.
 * (a) wait_for_messages shipped an addressed message's text twice: once in messages[] and again in
 *     addressed_to_you[]. An ask already in this response's messages[] is now referenced by id
 *     ({in_messages:true}), so each response carries an ask's text once.
 * (b) a no-recruit hub (CHATROOM_NO_RECRUIT=1, every benchmark arm) refuses every recruitment, yet listed
 *     request_agent / replace_participant / list_agents, whose schemas are re-sent to each seat every turn.
 *     They are now left off the tool list there; a normal hub still lists them.
 * Run: npx tsx scripts/per-turn-payload-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { Spawner } from "../src/spawner.js";

const cases: [string, () => Promise<void> | void][] = [];
function test(name: string, run: () => Promise<void> | void) {
  cases.push([name, run]);
}

async function connect(hub: Hub, spawner?: Spawner) {
  const s = createSessionServer(hub, spawner);
  const c = new Client({ name: "c", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await s.server.connect(st);
  await c.connect(ct);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await c.callTool({ name, arguments: args });
    return JSON.parse((r.content as { text: string }[])[0].text);
  };
  return { c, call };
}

const RECRUIT_TOOLS = ["request_agent", "replace_participant", "list_agents"];
const spawner = () => new Spawner({ mcpUrl: "http://127.0.0.1:1/mcp", defaultCwd: tmpdir(), logDir: mkdtempSync(join(tmpdir(), "ptp-")), dryRun: true });

async function toolList(noRecruit: boolean) {
  const prior = process.env.CHATROOM_NO_RECRUIT;
  if (noRecruit) process.env.CHATROOM_NO_RECRUIT = "1";
  else delete process.env.CHATROOM_NO_RECRUIT;
  try {
    const { c } = await connect(new Hub(), spawner());
    return (await c.listTools()).tools;
  } finally {
    if (prior === undefined) delete process.env.CHATROOM_NO_RECRUIT;
    else process.env.CHATROOM_NO_RECRUIT = prior;
  }
}

test("a no-recruit hub does not list the recruitment tools; a normal hub still does", async () => {
  const normal = await toolList(false);
  const bench = await toolList(true);
  for (const t of RECRUIT_TOOLS) {
    assert.ok(normal.some((x) => x.name === t), `normal hub lists ${t}`);
    assert.ok(!bench.some((x) => x.name === t), `no-recruit hub must not list ${t}`);
  }
  const bytes = (ts: typeof normal) => JSON.stringify(ts).length;
  console.log(`  tool list: normal ${bytes(normal)} chars, no-recruit ${bytes(bench)} chars (-${bytes(normal) - bytes(bench)} per seat per turn)`);
});

test("an ask delivered in messages[] is referenced by id in addressed_to_you, not sent twice", async () => {
  const hub = new Hub();
  const a = await connect(hub);
  const b = await connect(hub);
  const room = "ptp-dup";
  await a.call("join_room", { room, name: "alice", agent: "test" });
  await b.call("join_room", { room, name: "bob", agent: "test" });
  await b.call("wait_for_messages", { room, timeout_ms: 0 });
  const ask = "@bob which commit should I test? " + "x".repeat(150);
  await a.call("send_message", { room, content: ask });
  const w = await b.call("wait_for_messages", { room, timeout_ms: 0 });
  assert.ok(w.messages.some((m: string) => m.includes("which commit")), "the ask is in messages[]");
  assert.equal(w.addressed_to_you.length, 1);
  assert.equal(w.addressed_to_you[0].in_messages, true);
  assert.equal(w.addressed_to_you[0].text, undefined, "the ask's text is not repeated");
  assert.ok(w.addressed_to_you[0].id, "the ask is still referenced by id for reply_to");
});

test("an owed ask re-sent on a later wait still appears exactly once in the response", async () => {
  const hub = new Hub();
  const a = await connect(hub);
  const b = await connect(hub);
  const room = "ptp-owed";
  await a.call("join_room", { room, name: "alice", agent: "test" });
  await b.call("join_room", { room, name: "bob", agent: "test" });
  await b.call("wait_for_messages", { room, timeout_ms: 0 });
  await a.call("send_message", { room, content: "@bob which commit should I test?" });
  await b.call("wait_for_messages", { room, timeout_ms: 0 });
  await a.call("send_message", { room, content: "alice: unrelated progress note" });
  const w = await b.call("wait_for_messages", { room, timeout_ms: 0 });
  const body = JSON.stringify(w);
  assert.equal(body.split("which commit").length - 1, 1, `the outstanding ask's text appears once; got ${body}`);
  assert.ok(w.addressed_to_you.length >= 1, "the outstanding ask is still listed as owed");
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
console.log(`PER-TURN PAYLOAD: ${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
