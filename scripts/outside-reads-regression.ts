/**
 * Reads of a room by a seat that is not in it are recorded and shown. Run: npx tsx --test scripts/outside-reads-regression.ts
 *
 * Groups with opposing briefs work in separate rooms and are told not to read each other's (prompts/group.md), but the
 * hub lets any connection read any room: board_get, read_messages and room_status need no seat there, and GET
 * /rooms/<room> needs nothing at all. Whether a group stayed independent could not be counted afterwards (room
 * swarm-003601-tky5-room, inbox/swarm-003601-tky5-tky5-ns-shape/two-launch-groups: "Peeking could not be counted:
 * non-member reads are not in the room record"). The hub does not refuse these reads (the consolidator and the verifier
 * make them by design); it records who read what, and room_status shows the count per reader.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

const BUILD = "swarm-000001-outs-build", BREAK = "swarm-000001-outs-break";
type Summary = { outside_reads?: { total: number; by: Record<string, number> } };

async function connect(hub: Hub) {
  const session = createSessionServer(hub);
  const client = new Client({ name: "t", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st);
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse((r.content as { text: string }[])[0].text);
  };
  return { call, sessionKey: session.sessionKey };
}
const quiet = (hub: Hub, ...rooms: string[]) => { for (const r of rooms) { const x = hub.getRoom(r); clearTimeout(x.nudgeTimer); clearTimeout(x.openingsTimer); } };

test("a hub tool read of a room by a seat of another room is recorded against its name; a member's read is not", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "outside-reads-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hub = new Hub({ dataDir: dir });
  const builder = await connect(hub), breaker = await connect(hub), stranger = await connect(hub);
  await builder.call("join_room", { room: BUILD, name: "build-1", agent: "test" });
  await breaker.call("join_room", { room: BREAK, name: "break-1", agent: "test" });
  t.after(() => quiet(hub, BUILD, BREAK));
  await breaker.call("board_set", { room: BREAK, key: "position", text: "the rule fails" });

  await breaker.call("board_get", { room: BREAK, key: "position" });
  await breaker.call("room_status", { room: BREAK });
  assert.equal((hub.summary(hub.getRoom(BREAK), true) as Summary).outside_reads, undefined, "a member reading its own room is not an outside read");

  await builder.call("board_get", { room: BREAK, key: "position" });
  await builder.call("board_get", { room: BREAK });
  await builder.call("read_messages", { room: BREAK, since_seq: 0 });
  await builder.call("room_status", { room: BREAK });
  await stranger.call("board_get", { room: BREAK });
  const got = (hub.summary(hub.getRoom(BREAK), true) as Summary).outside_reads;
  assert.deepEqual(got, { total: 5, by: { [`build-1 (${BUILD})`]: 4, "a connection with no seat": 1 } });
  assert.deepEqual((hub.summary(hub.getRoom(BREAK), false) as Summary).outside_reads, got, "room_status shows it to the seats too");
  assert.equal((hub.summary(hub.getRoom(BUILD), true) as Summary).outside_reads, undefined, "the reader's own room has none");

  // the record carries who, how and what, and a restarted hub still has the count
  const again = new Hub({ dataDir: dir });
  t.after(() => quiet(again, BUILD, BREAK));
  assert.deepEqual((again.summary(again.getRoom(BREAK), true) as Summary).outside_reads, got, "rebuilt from the log");
});

test("a seat's shell command that fetches another room's address is recorded too; its own room's is not", (t) => {
  const hub = new Hub({});
  const a = hub.join(BUILD, "build-1", "claude", {}, undefined, "s-build").participant;
  hub.join(BREAK, "break-1", "claude", {}, undefined, "s-break");
  t.after(() => quiet(hub, BUILD, BREAK));
  hub.bindSeat("seat-key-build", "s-build");
  hub.heartbeatSeat("seat-key-build", { tool: "Bash", detail: `curl -s http://127.0.0.1:7717/rooms/${BUILD}/messages?since=0` });
  hub.heartbeatSeat("seat-key-build", { tool: "Bash", detail: "python3 score.py test" });
  assert.equal((hub.summary(hub.getRoom(BREAK), true) as Summary).outside_reads, undefined);
  hub.heartbeatSeat("seat-key-build", { tool: "Bash", detail: `curl -s http://127.0.0.1:7717/rooms/${BREAK} | python3 -c 'import json'` });
  hub.heartbeatSeat("seat-key-build", { tool: "WebFetch", detail: `http://127.0.0.1:7717/rooms/${BREAK}/transcript` });
  assert.deepEqual((hub.summary(hub.getRoom(BREAK), true) as Summary).outside_reads, { total: 2, by: { [`build-1 (${BUILD})`]: 2 } });
  // a room whose name merely starts with another's is not that room
  hub.join(`${BREAK}-2`, "x", "claude", {}, undefined, "s-x");
  t.after(() => quiet(hub, `${BREAK}-2`));
  hub.heartbeatSeat("seat-key-build", { tool: "Bash", detail: `curl -s http://127.0.0.1:7717/rooms/${BREAK}-2` });
  assert.equal((hub.summary(hub.getRoom(BREAK), true) as Summary).outside_reads?.total, 2);
  assert.equal((hub.summary(hub.getRoom(`${BREAK}-2`), true) as Summary).outside_reads?.total, 1);
  assert.ok(a.active);
});
