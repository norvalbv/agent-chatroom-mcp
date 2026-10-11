/**
 * A room that has stopped working says so (owner input B, swarm-003601-tky5). Run: npx tsx --test scripts/room-idle-regression.ts
 *
 * swarm-094251-5y46 had six seats for eight hours. Output per half hour averaged 285k tokens until 13:00 UTC, then fell
 * to 80k, 24k, 19k, 11k: every lead had been tested by 13:15, the brief said not to wrap up early, and the seats sat in
 * 10-minute sleep loops for the remaining three hours (runs of 159, 91, 84 and 73 minutes) without one of them saying
 * so. The hub held every seat's tool calls and said nothing. Covers: the rule (fewer than ROOM_IDLE_STEPS new steps per
 * seat over ROOM_IDLE_MS, counted from what the record already holds); one line to the room, addressed to the chair,
 * with the numbers and the time left; room_status carries it; a repeated sleep is not a step; work resuming clears it
 * and a second stall is told again; it is not raised while a proposal is open, under a hold, once the deadline line
 * has gone out, or for seats whose tool calls the hub cannot see; a breakout's stall reaches its parent; a replay
 * rebuilds it.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";
import { ROOM_IDLE_MS, ROOM_IDLE_STEPS, checkRoomIdle, quietWindow, roomSteps } from "../src/hub/idle.js";

const ROOM = "room-idle-regression";
const QUIET = "has gone quiet";
type Idle = { since: string; steps: number; seats: number; window_min: number } | undefined;

function room3(dataDir?: string, name = ROOM, extra: Record<string, unknown> = {}) {
  const hub = new Hub({ dataDir });
  const opts = { requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 0, ...extra };
  const [a, b, c] = ["A", "B", "C"].map((n, i) => hub.join(name, n, "claude", i ? {} : opts, undefined, `s-${name}-${n}`).participant);
  return { hub, room: hub.getRoom(name), a, b, c };
}
/** Each seat makes `n` tool calls on something new: what a working seat's hook reports. */
let serial = 0;
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
const lines = (hub: Hub, name = ROOM) => hub.getRoom(name).messages.filter((m) => m.from.id === "system" && m.content.includes(QUIET));
const idle = (hub: Hub, name = ROOM) => (hub.summary(hub.getRoom(name)) as unknown as { idle?: Idle }).idle;

test("the rule: fewer than N new steps per seat over the window", () => {
  const at = 10_000_000;
  const steps = (n: number, ago: number) => Array.from({ length: n }, () => at - ago);
  assert.deepEqual(quietWindow(steps(28, 60_000), 6, at), { steps: 28, seats: 6, window_ms: ROOM_IDLE_MS, quiet: true }, "the Polymarket room at 13:57 UTC: 28 steps, 6 seats");
  assert.equal(quietWindow(steps(ROOM_IDLE_STEPS * 6, 60_000), 6, at).quiet, false, "N per seat is working");
  assert.equal(quietWindow(steps(200, ROOM_IDLE_MS + 1), 6, at).steps, 0, "steps before the window do not count");
  assert.equal(quietWindow(steps(0, 0), 1, at).quiet, false, "one seat is not a room");
  assert.equal(quietWindow(steps(3, 0), 2, at, { windowMs: 60_000, stepsPerSeat: 2 }).quiet, true, "both numbers can be passed");
  // the threshold is a rate (steps per seat per 30 minutes): a shorter window asks for proportionally fewer steps.
  // Dev room swarm-005430-pwis-room ran a 2-minute window against the 30-minute count and called 12 steps from 4 seats quiet.
  assert.equal(quietWindow(steps(12, 1_000), 4, at, { windowMs: 120_000 }).quiet, false, "12 steps from 4 seats in 2 minutes is a working room");
  assert.equal(quietWindow(steps(3, 1_000), 4, at, { windowMs: 120_000 }).quiet, true, "3 from 4 is not: under one each");
  assert.equal(quietWindow(steps(59, 1_000), 6, at, { windowMs: 60 * 60_000 }).quiet, true, "and a longer one for more: 59 from 6 seats in an hour is under ten each");
  assert.equal(quietWindow(steps(60, 1_000), 6, at, { windowMs: 60 * 60_000 }).quiet, false);
});

test("a working room is not told; a stalled one is told once, with the numbers, and room_status carries it", () => {
  const { hub, room, a, b, c } = room3();
  const all = [a.id, b.id, c.id];
  hub.join(ROOM, "chair-x", "claude", {}, undefined, "s-chair", "chair");
  hub.setDeadline(ROOM, new Date(Date.now() + 5 * 3600_000).toISOString());
  work(hub, ROOM, all, 20);
  hub.send(ROOM, a.id, "tested the rule on the August slice, it fails", undefined, true);
  elapse(hub, ROOM, ROOM_IDLE_MS + 60_000);
  work(hub, ROOM, all, ROOM_IDLE_STEPS);
  checkRoomIdle(hub, room);
  assert.equal(lines(hub).length, 0, "N new steps per seat in the window: working");
  assert.equal(idle(hub), undefined);

  // the last room's afternoon: the same sleep, again and again, and one wait between
  elapse(hub, ROOM, ROOM_IDLE_MS + 60_000);
  for (let i = 0; i < 12; i++) for (const pid of all) hub.heartbeat(ROOM, pid, { tool: "Bash", detail: "T=$(( $(date +%s) + 590 )); until [ $(date +%s) -ge $T ]; do sleep 5; done" });
  assert.equal(roomSteps(room, Date.now()).length, 3, "a repeated sleep is one step per seat, not twelve");
  checkRoomIdle(hub, room);
  const [line] = lines(hub);
  assert.ok(line, "the stall is said in the room");
  assert.match(line.content, /^@chair-x /, "addressed to the chair, who can re-target the room");
  assert.match(line.content, /3 seats/); assert.match(line.content, /3 new steps/); assert.match(line.content, /30 min/);
  assert.match(line.content, /5 h 0 min remain/, "says how much of the run is left");
  assert.match(line.content, /idea\//, "names what a seat with an empty queue does instead of sleeping");
  assert.deepEqual({ steps: idle(hub)?.steps, seats: idle(hub)?.seats, window_min: idle(hub)?.window_min }, { steps: 3, seats: 3, window_min: 30 });

  checkRoomIdle(hub, room);
  assert.equal(lines(hub).length, 1, "told once, not on every sweep");
  elapse(hub, ROOM, 2 * ROOM_IDLE_MS + 60_000);
  // a seat has just spoken: the repeat waits, since "quiet for N min" said seconds after a message is false
  hub.send(ROOM, a.id, "waiting on the 14:00 close, the recorder scores it at 14:05", undefined, true);
  checkRoomIdle(hub, room);
  assert.equal(lines(hub).length, 1, "not repeated on top of a message");
  elapse(hub, ROOM, ROOM_IDLE_MS / 2);
  checkRoomIdle(hub, room);
  assert.equal(lines(hub).length, 2, "still stalled two windows later: told again");
  assert.match(lines(hub)[1].content, /quiet for \d+ min/, "and says for how long");

  work(hub, ROOM, all, ROOM_IDLE_STEPS);
  checkRoomIdle(hub, room);
  assert.equal(idle(hub), undefined, "work resumed: room_status drops it");
  elapse(hub, ROOM, ROOM_IDLE_MS + 60_000);
  checkRoomIdle(hub, room);
  assert.equal(lines(hub).length, 3, "a second stall is a new one");
});

test("not raised where it would be noise or a guess", () => {
  const stall = (name: string, extra: Record<string, unknown> = {}) => {
    const r = room3(undefined, name, extra);
    work(r.hub, name, [r.a.id, r.b.id, r.c.id], 3);
    elapse(r.hub, name, ROOM_IDLE_MS + 60_000);
    return r;
  };
  {
    const { hub, room } = stall("idle-plain");
    checkRoomIdle(hub, room);
    assert.equal(lines(hub, "idle-plain").length, 1, "the control: this room stalls");
    assert.doesNotMatch(lines(hub, "idle-plain")[0].content, /remain/, "no deadline, no time left to quote");
    assert.doesNotMatch(lines(hub, "idle-plain")[0].content, /^@/, "no chair, nobody addressed");
  }
  {
    const { hub, room, a } = stall("idle-proposal");
    hub.propose("idle-proposal", a.id, "The rule fails on held-out data at every bankroll we tried.");
    elapse(hub, "idle-proposal", ROOM_IDLE_MS + 60_000);
    checkRoomIdle(hub, room);
    assert.equal(lines(hub, "idle-proposal").length, 0, "a room waiting on a vote is not stalled");
  }
  {
    const { hub, room, a } = stall("idle-hold");
    hub.setBoard("idle-hold", a.id, "hold/idle-hold", "waiting for the owner's answer on the wallet");
    elapse(hub, "idle-hold", ROOM_IDLE_MS + 60_000);
    checkRoomIdle(hub, room);
    assert.equal(lines(hub, "idle-hold").length, 0, "nor one that is held");
  }
  {
    const { hub, room } = stall("idle-deadline");
    hub.setDeadline("idle-deadline", new Date(Date.now() + 3600_000).toISOString());
    room.deadline!.announced = true;
    checkRoomIdle(hub, room);
    assert.equal(lines(hub, "idle-deadline").length, 0, "nor once the hub has told the room it is ending");
  }
  {
    // seats with no tool hook (openrouter, a bare MCP client): the hub cannot see their work, so silence proves nothing
    const hub = new Hub({});
    for (const n of ["A", "B", "C"]) hub.join("idle-blind", n, "openrouter", { requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 0 }, undefined, `sb-${n}`);
    elapse(hub, "idle-blind", ROOM_IDLE_MS + 60_000);
    checkRoomIdle(hub, hub.getRoom("idle-blind"));
    assert.equal(lines(hub, "idle-blind").length, 0);
  }
  {
    const { hub, room } = room3(undefined, "idle-young");
    work(hub, "idle-young", [...room.participants.keys()], 1);
    checkRoomIdle(hub, room);
    assert.equal(lines(hub, "idle-young").length, 0, "seats that have not been here a whole window");
  }
});

test("only the room's own seats count: another room's note, the launcher's seeding and the hub's lines do not", () => {
  // the dress rehearsal (swarm-013051-mgzm on 7857): a consolidator's digest written into a group's board, and the
  // launcher's resource/* seeding, read as the group working; a group that only receives notes is still quiet
  const { hub, room, a, b, c } = room3(undefined, "idle-outside");
  work(hub, "idle-outside", [a.id, b.id, c.id], 2);
  elapse(hub, "idle-outside", ROOM_IDLE_MS + 60_000);
  // as many as the room's own threshold: the kit seeds 10 resource/* entries, and each digest pass writes a note
  for (let i = 0; i < 10; i++) hub.setBoardAs("idle-outside", "launcher", `resource/r${i}`, `resource ${i}: where it is and who shares it`);
  for (let i = 0; i < 3 * ROOM_IDLE_STEPS; i++) hub.setBoardAs("idle-outside", `digest-${i}`, `inbox/run-leads/digest-${i}`, `Pass ${i}. From the break room: r03 still disputed.`);
  checkRoomIdle(hub, room);
  assert.equal(lines(hub, "idle-outside").length, 1, "notes from outside do not make a room busy");
  hub.setBoard("idle-outside", a.id, "inbox/run-leads/digest.ack", "ack: the split by id is running now");
  work(hub, "idle-outside", [a.id, b.id, c.id], ROOM_IDLE_STEPS);
  checkRoomIdle(hub, room);
  assert.equal(idle(hub, "idle-outside"), undefined, "its own seats' answer does");
});

test("a breakout's stall reaches its parent, where the chair or consolidator sits", () => {
  const { hub, a, b } = room3(undefined, "idle-parent");
  for (const [p, s] of [[a, "s-idle-parent-A"], [b, "s-idle-parent-B"]] as const) hub.join("idle-child", p.name, "claude", { parent: "idle-parent", requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 0 }, undefined, s);
  const child = hub.getRoom("idle-child");
  work(hub, "idle-child", [...child.participants.keys()], 2);
  elapse(hub, "idle-child", ROOM_IDLE_MS + 60_000);
  checkRoomIdle(hub, child);
  assert.equal(lines(hub, "idle-child").length, 1);
  const up = lines(hub, "idle-parent");
  assert.equal(up.length, 1, "one line in the parent");
  assert.match(up[0].content, /idle-child/);
});

test("the record holds each episode, and a replay rebuilds the state", () => {
  const dir = mkdtempSync(join(tmpdir(), "room-idle-"));
  try {
    const { hub, room, a, b, c } = room3(dir, "idle-replay");
    work(hub, "idle-replay", [a.id, b.id, c.id], 2);
    elapse(hub, "idle-replay", ROOM_IDLE_MS + 60_000);
    checkRoomIdle(hub, room);
    const events = () => readFileSync(join(dir, "idle-replay.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { type: string; steps?: number; seats?: number; window_min?: number; idle_min?: number });
    const told = events().find((e) => e.type === "room_idle");
    assert.deepEqual({ steps: told?.steps, seats: told?.seats, window_min: told?.window_min }, { steps: 0, seats: 3, window_min: 30 }, "telemetry: the episode with its numbers");

    const again = new Hub({ dataDir: dir });
    assert.ok(idle(again, "idle-replay"), "a restarted hub still knows the room is stalled");
    checkRoomIdle(again, again.getRoom("idle-replay"));
    assert.equal(lines(again, "idle-replay").length, 1, "and does not say it twice");

    work(hub, "idle-replay", [a.id, b.id, c.id], ROOM_IDLE_STEPS);
    checkRoomIdle(hub, room);
    assert.ok(events().some((e) => e.type === "room_active" && typeof e.idle_min === "number"), "and when it ended, after how long");
    const third = new Hub({ dataDir: dir });
    assert.equal(idle(third, "idle-replay"), undefined);
    assert.equal(roomSteps(third.getRoom("idle-replay"), Date.now()).length >= 3 * ROOM_IDLE_STEPS, true, "work steps are rebuilt from the record");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
