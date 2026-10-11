/**
 * A launched seat's local command that reads a room it has no seat in is recorded and shown.
 * Run: npx tsx --test scripts/outside-reads-regression.ts
 *
 * Groups with opposing briefs work in separate rooms and are told not to read each other's (prompts/group.md), but
 * GET /rooms/<room> needs no identity and the room's log is a file on the same machine, so a seat with a shell can read
 * another group's room and nothing in the record shows it (room swarm-003601-tky5-room,
 * inbox/swarm-003601-tky5-tky5-ns-shape/result (d): "a seat with a shell can read a room over HTTP or from data/*.jsonl
 * unseen"). The seat's tool hook already reports every command to the hub, so the hub records who named which room and
 * room_status shows the count per reader. Nothing is refused: the consolidator and the verifier read group rooms this
 * way by design. Hub tools called from outside are counted separately, on call_completion (outside_calls).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const BUILD = "swarm-000001-outs-build", BREAK = "swarm-000001-outs-break";
type Summary = { outside_reads?: { total: number; by: Record<string, number> } };

const quiet = (hub: Hub, ...rooms: string[]) => { for (const r of rooms) { const x = hub.getRoom(r); clearTimeout(x.nudgeTimer); clearTimeout(x.openingsTimer); } };

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

test("the room's log file counts, a reader with no seat left is still named, and a restarted hub keeps the count", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "outside-reads-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hub = new Hub({ dataDir: dir });
  const a = hub.join(BUILD, "build-1", "claude", {}, undefined, "s-build").participant;
  hub.join(BUILD, "build-2", "claude", {}, undefined, "s-build2");
  hub.join(BREAK, "break-1", "claude", {}, undefined, "s-break");
  t.after(() => quiet(hub, BUILD, BREAK));
  hub.bindSeat("seat-key-build", "s-build");
  hub.heartbeatSeat("seat-key-build", { tool: "Bash", detail: `grep -c position "/x/agent-chatroom-mcp/data/${BREAK}.jsonl"` });
  hub.heartbeatSeat("seat-key-build", { tool: "Read", detail: `/x/agent-chatroom-mcp/data/${BUILD}.jsonl` });
  hub.heartbeatSeat("seat-key-build", { tool: "mcp__chatroom__board_get", hub: true, detail: `/rooms/${BREAK}` });
  const want = { total: 1, by: { [`build-1 (${BUILD})`]: 1 } };
  assert.deepEqual((hub.summary(hub.getRoom(BREAK), true) as Summary).outside_reads, want, "its own room's log and a hub call are not outside reads");
  assert.deepEqual((hub.summary(hub.getRoom(BREAK), false) as Summary).outside_reads, want, "room_status shows it to the seats too");
  hub.leave(BUILD, a.id, "done");
  const again = new Hub({ dataDir: dir });
  t.after(() => quiet(again, BUILD, BREAK));
  assert.deepEqual((again.summary(again.getRoom(BREAK), true) as Summary).outside_reads, want, "rebuilt from the log, named after the seat left");
});
