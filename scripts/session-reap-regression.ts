/** A seat that took its place back on a newer MCP session is not thrown out when the older, idle one is reaped
 * (evidence pack item 6, bugs.md 3: a chair on hubcall.py was posted as "left the room" at 14:50, 15:23 and 15:54 UTC
 * while a newer session was long-polling as the same participant; 18 such drops in 5 runs).
 * Run: npx tsx scripts/session-reap-regression.ts
 * In-process sessions over the real MCP guard; isolated tmp data dir, no port.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dir = mkdtempSync(join(tmpdir(), "session-reap-"));
const hub = new Hub({ dataDir: dir });
const open: Client[] = [];
async function connect() {
  const session = createSessionServer(hub);
  const client = new Client({ name: "t", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st);
  await client.connect(ct);
  open.push(client);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: { room: "reap", ...args } })) as { isError?: boolean; content: { text: string }[] };
    return { error: r.isError === true, text: r.content[0].text };
  };
  return { session, call };
}
const events = () => readFileSync(join(dir, "reap.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

try {
  const worker = await connect();
  assert.equal((await worker.call("join_room", { name: "worker", agent: "test" })).error, false);
  // the chair's first call opens one session and leaves it open, as hubcall.py does
  const older = await connect();
  const joined = await older.call("join_room", { name: "chair", agent: "test" });
  assert.equal(joined.error, false, joined.text);
  const id = JSON.parse(joined.text).participant_id as string;
  // its next call comes over a new session, taking the seat by the id it was issued
  const newer = await connect();
  assert.equal((await newer.call("join_room", { name: "chair", agent: "test", participant_id: id })).error, false);
  assert.equal((await newer.call("send_message", { content: "still here on the newer session", participant_id: id })).error, false);

  // 30 idle minutes later the hub reaps the older session (src/index.ts calls its leaveAll)
  older.session.leaveAll("MCP session closed without leave_room (idle, reaped)");
  const chair = hub.getRoom("reap").participants.get(id)!;
  assert.equal(chair.active, true, "the chair is live on its newer session and must stay in the room");
  assert.ok(!hub.getRoom("reap").messages.some((m) => m.kind === "system" && /chair.*left the room/.test(m.content)), "no 'left the room' line for a seat that is still served");
  await worker.call("wait_for_messages", { timeout_ms: 0 });
  const ask = await worker.call("send_message", { content: "@chair are you there?" });
  assert.equal(ask.error, false, `an @-mention of the chair is not refused as departed: ${ask.text}`);

  // the record says what happened to each session: the seat moved, then the older session ended without the seat
  const sessions = events().filter((e) => e.type === "session").map((e) => ({ event: e.event, name: e.name, kept: e.seat_kept }));
  assert.deepEqual(sessions, [
    { event: "moved", name: "chair", kept: true },
    { event: "closed", name: "chair", kept: true },
  ]);
  const closed = events().find((e) => e.type === "session" && e.event === "closed");
  assert.match(closed.reason, /reaped/);
  assert.ok(!JSON.stringify(events().filter((e) => e.type === "session")).includes(newer.session.sessionKey), "a session event never carries a session key");

  // the newer session ending is the seat leaving, and is recorded as such
  newer.session.leaveAll();
  assert.equal(chair.active, false);
  assert.deepEqual(events().filter((e) => e.type === "session").at(-1) && { event: events().filter((e) => e.type === "session").at(-1).event, kept: events().filter((e) => e.type === "session").at(-1).seat_kept }, { event: "closed", kept: false });
  console.log("session-reap-regression OK");
} finally {
  for (const c of open) await c.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
