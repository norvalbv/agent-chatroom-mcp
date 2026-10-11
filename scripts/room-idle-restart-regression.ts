/**
 * A stalled room is still stalled after a hub restart, and is not told so a second time when its seats come back.
 * A restarted hub restores every seat inactive until its next call (scripts/reseat-regression.ts), and the idle rule
 * (src/hub/idle.ts) judged the seats that were active: none at boot, one after the first call. "One seat is not a room",
 * so the rule read the room as not quiet, wrote room_active and dropped the stall; once the seats were back it found
 * the same quiet room, with nothing left to say it had been told, and posted "has gone quiet" again with the stall's
 * start moved to the restart (merge-review backlog B5, docs/self-improvement-swarm-003601-tky5.md).
 * Run: npx tsx scripts/room-idle-restart-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { ROOM_IDLE_MS, ROOM_IDLE_STEPS, checkRoomIdle } from "../src/hub/idle.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

const QUIET = "has gone quiet";
const SEATS = ["A", "B", "C"];
const dirs: string[] = [];
let serial = 0;
/** Each seat makes `n` tool calls on something new: what a working seat's hook reports. */
const work = (hub: Hub, room: string, pids: string[], n: number) => { for (const pid of pids) for (let i = 0; i < n; i++) hub.heartbeat(room, pid, { tool: "Bash", detail: `python3 run_${serial++}.py` }); };
/** Move everything the room has done so far `ms` into the past, as if that long had gone by. */
function elapse(hub: Hub, name: string, ms: number) {
  const room = hub.getRoom(name);
  const back = (iso: string) => new Date(Date.parse(iso) - ms).toISOString();
  for (const p of room.participants.values()) p.joinedAt = back(p.joinedAt);
  for (const m of room.messages) m.ts = back(m.ts);
  for (const e of room.board.values()) e.updatedAt = back(e.updatedAt);
  room.workAt = (room.workAt ?? []).map((t) => t - ms);
  if (room.idle) room.idle = { ...room.idle, since: back(room.idle.since), toldAt: back(room.idle.toldAt) };
}
/** Three seats that worked, then nothing for over a window, with the hub's sweep run: `stalled` says whether to stop there. */
function before(stalled: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "room-idle-restart-"));
  dirs.push(dir);
  const name = `idle-restart-${++serial}`;
  const hub = new Hub({ dataDir: dir });
  const ids = SEATS.map((n, i) => hub.join(name, n, "claude", i ? {} : { requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 0 }, undefined, `s-${name}-${n}`).participant.id);
  work(hub, name, ids, 2);
  if (stalled) {
    elapse(hub, name, ROOM_IDLE_MS + 60_000);
    checkRoomIdle(hub, hub.getRoom(name));
    assert.equal(lines(hub, name), 1, "the room is told once before the restart");
  }
  const events = (type: string) => readFileSync(join(dir, `${name}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { type: string }).filter((e) => e.type === type).length;
  return { dir, name, ids, events };
}
const lines = (hub: Hub, name: string) => hub.getRoom(name).messages.filter((m) => m.from.id === "system" && m.content.includes(QUIET)).length;
const idle = (hub: Hub, name: string) => (hub.summary(hub.getRoom(name)) as unknown as { idle?: { since: string } }).idle;
/** The hub started again on the room's record. The record holds real times, so the test's half hour is put back. */
function restart(dir: string, name: string): Hub {
  const hub = new Hub({ dataDir: dir });
  elapse(hub, name, ROOM_IDLE_MS + 60_000);
  return hub;
}
/** The seat's first call after the restart: it takes its seat back on a new connection. */
const back = (hub: Hub, name: string, i: number, id: string) => hub.join(name, SEATS[i], "claude", {}, id, `s2-${name}-${SEATS[i]}`);

test("a stalled room is still stalled at boot, while its seats come back one by one, and once they are all back", () => {
  const { dir, name, ids, events } = before(true);
  const hub = restart(dir, name);
  const since = idle(hub, name)?.since;
  assert.ok(since, "the restarted hub knows the room is stalled");
  const sweep = (when: string) => {
    checkRoomIdle(hub, hub.getRoom(name));
    assert.equal(events("room_active"), 0, `${when}: the record does not say the room is working again`);
    assert.equal(idle(hub, name)?.since, since, `${when}: room_status still carries the stall, from when it began`);
    assert.equal(lines(hub, name), 1, `${when}: the room is not told a second time`);
    assert.equal(events("room_idle"), 1, `${when}: one episode in the record`);
  };
  sweep("at boot, no seat back");
  ids.forEach((id, i) => { back(hub, name, i, id); sweep(`${i + 1} of 3 seats back`); });
});

test("work after the restart still ends the stall, once", () => {
  const { dir, name, ids, events } = before(true);
  const hub = restart(dir, name);
  checkRoomIdle(hub, hub.getRoom(name));
  ids.forEach((id, i) => back(hub, name, i, id));
  work(hub, name, ids, ROOM_IDLE_STEPS);
  checkRoomIdle(hub, hub.getRoom(name));
  assert.equal(events("room_active"), 1);
  assert.equal(idle(hub, name), undefined);
});

test("a seat that never comes back does not hold the rule for ever: after the away window the seats that did are judged", () => {
  const { dir, name, ids, events } = before(true);
  const hub = restart(dir, name);
  back(hub, name, 0, ids[0]); back(hub, name, 1, ids[1]);
  work(hub, name, ids.slice(0, 2), ROOM_IDLE_STEPS);
  checkRoomIdle(hub, hub.getRoom(name));
  assert.equal(events("room_active"), 0, "while the third may still come back, the room is not judged");
  const gone = hub.getRoom(name).participants.get(ids[2])!;
  gone.restoredAt = new Date(Date.now() - 11 * 60_000).toISOString();
  assert.equal(hub.away(gone), undefined, "the third seat is past the away window");
  checkRoomIdle(hub, hub.getRoom(name));
  assert.equal(events("room_active"), 1, "the two that are back and working end the stall");
});

test("a room whose seats pick their work up again as they return is told nothing, and an empty room is never 'active'", () => {
  const { dir, name, ids, events } = before(false);
  const hub = restart(dir, name);
  checkRoomIdle(hub, hub.getRoom(name));
  ids.forEach((id, i) => { back(hub, name, i, id); work(hub, name, [id], ROOM_IDLE_STEPS); checkRoomIdle(hub, hub.getRoom(name)); });
  assert.equal(lines(hub, name), 0);
  assert.equal(events("room_idle") + events("room_active"), 0);
  // every seat leaves a stalled room: nobody is there to be working
  const stalled = before(true);
  const live = restart(stalled.dir, stalled.name);
  for (const p of live.getRoom(stalled.name).participants.values()) delete p.restoredAt;
  checkRoomIdle(live, live.getRoom(stalled.name));
  assert.equal(stalled.events("room_active"), 0, "no seats is not a room working again");
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}
for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nROOM IDLE RESTART OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
