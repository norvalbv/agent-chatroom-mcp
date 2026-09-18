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
console.log("LIVENESS OK");
