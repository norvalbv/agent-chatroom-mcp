/** A room deadline the hub knows and announces. The launcher kills every seat at --timeout and told nobody: of 96 past
 * lead rooms 30 did not conclude (25 with no proposal at all, 4 with one still open) and 174 of 753 seats ended with no
 * reason and no handoff. Hub.setDeadline(room, at) records when the run stops; ONCE, when a fifth of the time from
 * setting to deadline remains (at least 2 min, at most 10 min before; at once if less remains) the hub posts one system
 * line saying so and what to do. With a proposal open it names it and who it waits on. With none it asks for handoff/*
 * first: a verified room needs a median 5.6 min from propose to its last verify, so "propose now" two minutes before
 * the kill only turns a room with no proposal into one with a proposal open; "propose only what the board already
 * supports" is added only where it can still pass (no verification required, 5 min or more left).
 * Seats see deadline_at and seconds_left (room_status, join_room, wait_for_messages) only from the announcement on: in
 * dev room swarm-002812-486p-room they read deadline_at at join, said "the room deadline is ~5 min, post evidence
 * fast", and concluded in 2 min on 2 of 9 files, before any announcement. The dashboard and HTTP summary always carry
 * it. Never in a concluded or closed room. A deadline set for a room nobody has created yet is held and applied at
 * creation.
 * npx tsx scripts/room-deadline-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub, HubError } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
const H = Hub as unknown as { DEADLINE_LEAD_MIN_MS: number; DEADLINE_LEAD_MAX_MS: number; DEADLINE_PROPOSE_MIN_MS: number; deadlineLeadMs?: (totalMs: number) => number };
assert.equal(typeof H.deadlineLeadMs, "function", "Hub.deadlineLeadMs exists");
const MIN = 60_000;
// a fifth of the run, never under 2 min nor over 10 min, and never more than the run itself
assert.equal(H.deadlineLeadMs!(5 * MIN), 2 * MIN, "5 min run: announced 2 min before");
assert.equal(H.deadlineLeadMs!(30 * MIN), 6 * MIN, "30 min run: announced 6 min before");
assert.equal(H.deadlineLeadMs!(180 * MIN), 10 * MIN, "180 min run: announced 10 min before");
assert.equal(H.deadlineLeadMs!(1 * MIN), 1 * MIN, "1 min run: announced at once");

// real timers below, so the bounds shrink: a 1.5 s deadline is announced 300 ms before it
H.DEADLINE_LEAD_MIN_MS = 100;
H.DEADLINE_LEAD_MAX_MS = 5_000;
assert.equal(H.DEADLINE_PROPOSE_MIN_MS, 5 * MIN, "a proposal is only suggested with 5 min or more left");
H.DEADLINE_PROPOSE_MIN_MS = 200;
const human = (room: string, h: Hub = hub) => h.summary(h.getRoom(room), true) as { deadline_at?: string; seconds_left?: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();
const dataDir = mkdtempSync(join(tmpdir(), "room-deadline-"));
const hub = new Hub({ dataDir });
async function seat(name: string, h: Hub = hub) {
  const session = createSessionServer(h);
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    return { error: !!r.isError, text: (r.content as { text: string }[])[0]?.text ?? "" };
  };
  return { call };
}
const lines = (room: string, h: Hub = hub) => h.getRoom(room).messages.filter((m) => m.kind === "system" && /This run stops at/.test(m.content));

// 1. no proposal: nothing early, one line inside the window, never a second
const room = "deadline-plain";
const a = await seat("a"); const b = await seat("b");
await a.call("join_room", { room, name: "A", agent: "test" });
await b.call("join_room", { room, name: "B", agent: "test" });
let r = await a.call("wait_for_messages", { room, timeout_ms: 0 });
const at = inMs(1500);
const set = hub.setDeadline(room, at);
assert.deepEqual({ pending: set.pending, deadline_at: set.deadline_at }, { pending: false, deadline_at: at }, "deadline set on an existing room");
assert.equal(human(room).deadline_at, at, "the dashboard summary carries deadline_at from the start");
assert.ok(typeof human(room).seconds_left === "number" && human(room).seconds_left! >= 0 && human(room).seconds_left! <= 2, "and seconds_left: " + human(room).seconds_left);
r = await a.call("room_status", { room });
assert.ok(!r.text.includes("deadline_at") && !r.text.includes("seconds_left"), "before the announcement a seat's room_status says nothing about the deadline");
r = await a.call("wait_for_messages", { room, timeout_ms: 0 });
assert.ok(!r.text.includes("deadline"), "before the announcement a wait carries nothing about the deadline: " + r.text);
await sleep(600);
assert.equal(lines(room).length, 0, "nothing is announced with more than a fifth of the time left");
await sleep(750);
assert.equal(lines(room).length, 1, "one line once a fifth of the time remains");
const line = lines(room)[0].content;
assert.match(line, /^This run stops at \d\d:\d\d:\d\d UTC \(in [^)]+\)\. Seats are killed then\. Write what you have and the next step on handoff\/<area> now; a run that stops without a conclusion is judged by what is on the board\. Propose only what the board already supports\.$/, line);
assert.ok(line.includes(at.slice(11, 19)), "the line names the deadline's own clock time: " + line);
r = await a.call("room_status", { room });
let st = JSON.parse(r.text) as { deadline_at?: string; seconds_left?: number };
assert.ok(st.deadline_at === at && typeof st.seconds_left === "number", "once announced, a seat's room_status carries deadline_at and seconds_left: " + st.deadline_at);
r = await a.call("wait_for_messages", { room, timeout_ms: 0 });
let w = JSON.parse(r.text) as { deadline?: { at: string; seconds_left: number }; unchanged?: boolean };
assert.equal(w.deadline?.at, at, "inside the window the wait snapshot carries the deadline: " + r.text);
r = await a.call("wait_for_messages", { room, timeout_ms: 0 });
w = JSON.parse(r.text);
assert.ok(w.unchanged && w.deadline?.at === at, "a ticking seconds_left does not defeat the unchanged-snapshot compaction, and the deadline still travels: " + r.text);
await sleep(600);
assert.equal(lines(room).length, 1, "the line is posted once, not again at the deadline");

// 2. a proposal is open: the line names it and who it waits on
const open = "deadline-proposal";
await a.call("join_room", { room: open, name: "A", agent: "test" });
await b.call("join_room", { room: open, name: "B", agent: "test" });
r = await a.call("propose", { room: open, text: "The parser is correct as it stands." });
const pid = (JSON.parse(r.text) as { id: string }).id;
hub.setDeadline(open, inMs(50)); // less than the minimum lead remains: at once
await sleep(60);
assert.equal(lines(open).length, 1, "less than the lead remains: announced at once");
assert.ok(lines(open)[0].content.includes(pid) && /waits on B\b/.test(lines(open)[0].content) && !/Propose only/.test(lines(open)[0].content),
  "with a proposal open the line names it and who it waits on: " + lines(open)[0].content);

// 2b. no proposal, and one could not pass in the time left: handoff only
const verified = "deadline-verified";
hub.createRoom(verified, { requireVerification: true });
await a.call("join_room", { room: verified, name: "A", agent: "test" });
hub.setDeadline(verified, inMs(1500));
const short = "deadline-short";
await a.call("join_room", { room: short, name: "A", agent: "test" });
hub.setDeadline(short, inMs(150)); // under DEADLINE_PROPOSE_MIN_MS left when it is announced
await sleep(1300);
for (const [name, why] of [[verified, "a room that requires verification"], [short, "a room with under 5 min left"]] as const) {
  assert.equal(lines(name).length, 1, `${why} is told`);
  assert.ok(/handoff\/<area> now; a run that stops without a conclusion is judged by what is on the board\.$/.test(lines(name)[0].content) && !/[Pp]ropose/.test(lines(name)[0].content), `${why} is asked for a handoff, not a proposal: ` + lines(name)[0].content);
}

// 3. never in a closed room
const shut = "deadline-closed";
await a.call("join_room", { room: shut, name: "A", agent: "test" });
hub.setDeadline(shut, inMs(400));
hub.closeRoom(shut, "test");
await sleep(450);
assert.equal(lines(shut).length, 0, "a closed room gets no deadline line");
assert.throws(() => hub.setDeadline(shut, inMs(400)), HubError, "a closed room takes no deadline");

// 4. the room does not exist yet (seats create it by joining): held, applied at creation
const later = "deadline-later";
const held = hub.setDeadline(later, inMs(400));
assert.equal(held.pending, true, "a deadline for an unknown room is held, not refused");
await a.call("join_room", { room: later, name: "A", agent: "test" });
assert.equal(human(later).deadline_at, held.deadline_at, "the held deadline is applied when the room is created");
await sleep(450);
assert.equal(lines(later).length, 1, "and announced on its original clock");

// 5. bad input
assert.throws(() => hub.setDeadline(room, "soon"), HubError, "an unparseable time is refused");
assert.throws(() => hub.setDeadline(room, new Date(Date.now() - 1000).toISOString()), HubError, "a time in the past is refused");

// 6. persisted: a restarted hub knows the deadline, does not repeat a line already posted, and still posts one that was not
const pend = "deadline-restart";
await a.call("join_room", { room: pend, name: "A", agent: "test" });
const pendAt = inMs(1500);
hub.setDeadline(pend, pendAt);
const hub2 = new Hub({ dataDir });
assert.equal(human(room, hub2).deadline_at, at, "the deadline survives a restart");
assert.equal(human(pend, hub2).deadline_at, pendAt);
// a delay past setTimeout's 32-bit limit must not fire at once
hub.setDeadline(later, new Date(Date.now() + 40 * 24 * 3600_000).toISOString());
await sleep(50);
assert.equal(lines(later).length, 1, "a deadline weeks away is not announced now");
await sleep(1400);
assert.equal(lines(room, hub2).length, 1, "a restart does not post the line a second time");
assert.equal(lines(pend, hub2).length, 1, "a restart re-arms a deadline not yet announced");

console.log("ROOM DEADLINE OK");
process.exit(0);
