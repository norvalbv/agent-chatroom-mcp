/** A seat working locally (run_command, file edits) makes no hub calls, so the room showed "1 msg, 12m ago" for a
 * builder that was on step 71 of a build (bench-3, 2026-09-17 23:56Z). Seats now heartbeat their step and tool over
 * HTTP; the hub keeps it per participant, shows it in the summary, and the idle sweep trusts it.
 * npx tsx scripts/liveness-regression.ts */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

const hub = new Hub();
const room = hub.createRoom("liveness", { expectedParticipants: 0 });
const a = hub.join(room.name, "bench-3", "openrouter", {}, undefined, "s-a").participant;
const b = hub.join(room.name, "oracle-3", "openrouter", {}, undefined, "s-b").participant;

// 1. A heartbeat records what the seat is doing without touching the room's messages.
const before = room.messages.length;
hub.heartbeat(room.name, a.id, { tool: "run_command", step: 71 });
assert.equal(room.messages.length, before, "a heartbeat is not a message");
let s = hub.summary(room, true);
const pa = s.participants.find((p) => p.name === "bench-3")!;
assert.equal(pa.working?.tool, "run_command"); assert.equal(pa.working?.step, 71);
assert.ok(pa.last_seen_at && Date.parse(pa.last_seen_at) >= Date.parse(pa.last_active_at), "last_seen_at covers the heartbeat");
const pb = s.participants.find((p) => p.name === "oracle-3")!;
assert.equal(pb.working, null, "a seat that never heartbeats shows no work");
// (a departed seat keeps its last working entry: what it was doing when it went is worth knowing)

// 2. The idle sweep does not evict a seat with a fresh heartbeat even when its session is not in the connected set.
a.lastActiveAt = new Date(Date.now() - 30 * 60_000).toISOString();
b.lastActiveAt = new Date(Date.now() - 30 * 60_000).toISOString();
const swept = hub.sweepIdle(10 * 60_000, new Set());
assert.deepEqual(swept, ["oracle-3"], "only the seat with neither hub calls nor heartbeats is swept");
assert.equal(a.active, true);

// 3. A stale heartbeat does not protect forever.
a.working = { tool: "run_command", step: 71, at: new Date(Date.now() - 30 * 60_000).toISOString() };
assert.deepEqual(hub.sweepIdle(10 * 60_000, new Set()), ["bench-3"]);

// 4. Heartbeats for a departed or unknown participant are refused, not recorded.
assert.throws(() => hub.heartbeat(room.name, "p_nobody", { tool: "x", step: 1 }), /not a participant/);
assert.throws(() => hub.heartbeat(room.name, a.id, { tool: "x", step: 1 }), /have left/);
// 5. Each heartbeat carries what the seat is doing (the command text, a path, a pattern) and the hub keeps the last 60
//    per participant, so a click on a person in the dashboard shows their recent steps, not just "run_command".
const c = hub.join(room.name, "bench-5", "openrouter", {}, undefined, "s-c").participant;
for (let i = 1; i <= 70; i++) hub.heartbeat(room.name, c.id, { tool: "run_command", step: i, detail: `cd worktree && git log --oneline -${i}` });
const act = hub.activity(room.name, "bench-5");
assert.equal(act.length, 60, "ring buffer of 60");
assert.equal(act.at(-1)?.step, 70); assert.equal(act[0].step, 11);
assert.match(act.at(-1)!.detail, /git log --oneline -70/);
assert.equal(hub.summary(room, true).participants.find((p) => p.name === "bench-5")!.working?.detail, "cd worktree && git log --oneline -70");
hub.heartbeat(room.name, c.id, { tool: "read_file", step: 71, detail: "x".repeat(1000) });
assert.ok(hub.activity(room.name, "bench-5").at(-1)!.detail.length <= 300, "detail is capped");
assert.throws(() => hub.activity(room.name, "nobody"), /No participant/);
console.log("LIVENESS OK");
