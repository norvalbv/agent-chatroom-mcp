/** leave_room carries a reason and the hub refuses, once, a leave that abandons a claim or an unanswered ask.
 * Benji could not tell why six seats left a lobby (2026-09-17); the notice said only "left the room".
 * npx tsx scripts/leave-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dir = mkdtempSync(join(tmpdir(), "leave-"));
let hub = new Hub({ dataDir: dir });
async function seat(name: string) {
  const session = createSessionServer(hub);
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    return { error: !!r.isError, text: (r.content as { text: string }[])[0]?.text ?? "" };
  };
  return { call };
}
const room = "leave-test";
const a = await seat("a"); const b = await seat("b"); const c = await seat("c");
await a.call("join_room", { room, name: "A", agent: "test" });
await b.call("join_room", { room, name: "B", agent: "test" });
await c.call("join_room", { room, name: "C", agent: "test" });

// 1. An agent must say why it leaves.
let r = await a.call("leave_room", { room });
assert.ok(r.error && /reason/.test(r.text), "leave without a reason is refused: " + r.text);
r = await a.call("leave_room", { room, reason: "short" });
assert.ok(r.error && /reason/.test(r.text), "a token is not a reason");

// 2. A claim with no handoff is refused once, naming the claim and what to write.
await a.call("board_set", { room, key: "claim/metrics", text: JSON.stringify({ owner: "A", status: "open" }) });
r = await a.call("leave_room", { room, reason: "I am done with my slice and moving on" });
assert.ok(r.error && /claim\/metrics/.test(r.text) && /handoff\//.test(r.text), "orphaned claim refused once: " + r.text);
// ...a handoff clears it.
await a.call("board_set", { room, key: "handoff/metrics", text: "metric done, see evidence/metrics; nothing undone" });
r = await a.call("leave_room", { room, reason: "metrics slice finished, handed off in handoff/metrics" });
assert.ok(!r.error, "leave with handoff and reason succeeds: " + r.text);

// 3. An unanswered ask is refused once; the second call leaves anyway (the refusal is a nudge, not a cage).
r = await c.call("send_message", { room, content: "@B what did the gate deliver?", force: true });
assert.ok(!r.error, "ask sent: " + r.text);
await b.call("wait_for_messages", { room, timeout_ms: 0 });
r = await b.call("leave_room", { room, reason: "nothing more from me tonight" });
assert.ok(r.error && /asked you/.test(r.text) && /reply|pass/.test(r.text), "owed ask refused once: " + r.text);
r = await b.call("leave_room", { room, reason: "nothing more from me tonight" });
assert.ok(!r.error, "second call leaves anyway: " + r.text);

// 4. The reason is in the room and in the summary, and survives replay; a claim marked done counts as handed over.
const summary = hub.summary(hub.getRoom(room), true);
const pa = summary.participants.find((p) => p.name === "A")!;
assert.equal(pa.active, false); assert.equal(pa.left_reason, "metrics slice finished, handed off in handoff/metrics");
const notice = hub.getRoom(room).messages.filter((m) => m.kind === "system" && /A left the room/.test(m.content)).at(-1)!;
assert.match(notice.content, /A left the room: metrics slice finished/);
await c.call("board_set", { room, key: "claim/oracle", text: JSON.stringify({ owner: "C", status: "done" }) });
r = await c.call("leave_room", { room, reason: "oracle spec written, marked done on the claim" });
assert.ok(!r.error, "a claim whose status is done needs no handoff: " + r.text);
hub = new Hub({ dataDir: dir });
assert.equal(hub.summary(hub.getRoom(room), true).participants.find((p) => p.name === "B")!.left_reason, "nothing more from me tonight", "reason survives replay");
// 5. Humans and session cleanup are not gated: hub.leave with no reason still works.
const h = hub.join(room, "benji", "human").participant;
hub.leave(room, h.id);
console.log("LEAVE OK");
