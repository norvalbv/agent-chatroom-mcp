/**
 * Consolidator spawn (lobby item 3): when the LAST child room a lobby spawned has concluded, the spawner
 * starts exactly ONE consolidator seat in the lobby whose only job is to assemble the ranked list from the
 * children's conclusions and inbox/* board entries, propose it and leave — so no lobby seat waits for a
 * manually nominated drafter. Red on main: today the spawner fires nothing.
 * Run: npx tsx scripts/consolidator-spawn-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Spawner, type SpawnerHooks, type SpawnRequest, type SpawnedAgent } from "../src/spawner.js";

const roomState = new Map<string, string>(); // room -> "open" | "concluded" | "closed" | ...
const openProposal = new Set<string>(); // rooms holding an open proposal
const announcements: string[] = [];
const spawned: SpawnedAgent[] = []; // every agent this spawner has ever produced

const hooks: SpawnerHooks = {
  isHeld: () => false,
  claimArea: () => {},
  ensureRoom: () => {},
  announce: (_room, text) => announcements.push(text),
  liveAgents: () => 0,
  roomTopic: (room) => `topic of ${room}`,
  roomState: (room) => roomState.get(room),
  openProposal: (room) => openProposal.has(room),
};

const spawner = new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: process.cwd(), logDir: mkdtempSync(join(tmpdir(), "consolidator-spawn-")), dryRun: true });
spawner.attach(hooks);
const realRequest = spawner.request.bind(spawner);
spawner.request = ((req: SpawnRequest) => {
  const out = realRequest(req);
  spawned.push(...out);
  return out;
}) as typeof spawner.request;

/** all consolidator seats this spawner has fired into a lobby */
const consolidators = (lobby: string) => spawned.filter((a) => a.room === lobby && a.name === "consolidator");

const brief = "Work the area in a breakout room and report to the lobby.";

// ---------- 1. No child concluded yet: nothing fires ----------
const lobbyA = "lobby-a";
roomState.set(lobbyA, "open");
roomState.set("child-a1", "open");
roomState.set("child-a2", "open");
spawner.request({ room: lobbyA, requestedBy: "lobby-seat-a", brief, count: 1, newRoom: "child-a1", parentTopic: "rank the lobby list" });
spawner.request({ room: lobbyA, requestedBy: "lobby-seat-a", brief, count: 1, newRoom: "child-a2", parentTopic: "rank the lobby list" });
for (const c of spawned) assert.equal(c.reportTo, lobbyA, "children of a new_room request report to the lobby");
assert.equal(consolidators(lobbyA).length, 0);
spawner.checkConsolidators();
assert.equal(consolidators(lobbyA).length, 0, "no consolidator while children are still open");

// ---------- 2. Only the first child concluded: still nothing ----------
roomState.set("child-a1", "concluded");
spawner.checkConsolidators();
assert.equal(consolidators(lobbyA).length, 0, "no consolidator until EVERY child of the lobby has concluded");

// ---------- 3. Last child concludes: exactly ONE consolidator into the lobby ----------
roomState.set("child-a2", "concluded");
spawner.checkConsolidators();
const one = consolidators(lobbyA);
assert.equal(one.length, 1, "exactly one consolidator seat per lobby");
assert.equal(one[0].room, lobbyA);
assert.equal(one[0].reportTo, undefined, "the consolidator is a lobby seat, not a child");
assert.match(one[0].brief, /ranked list/);
assert.match(one[0].brief, /propose it to the lobby/);
assert.match(one[0].brief, /leave with a reason/);

// ---------- 4. Never fires twice ----------
spawner.checkConsolidators();
assert.equal(consolidators(lobbyA).length, 1, "once-only guard per lobby");

// ---------- 5. A later child appearing and concluding does not re-fire ----------
roomState.set("child-a3", "open");
spawner.request({ room: lobbyA, requestedBy: "lobby-seat-a", brief, count: 1, newRoom: "child-a3", parentTopic: "rank the lobby list" });
roomState.set("child-a3", "concluded");
spawner.checkConsolidators();
assert.equal(consolidators(lobbyA).length, 1, "no second consolidator when a straggler child concludes later");

// ---------- 6. Skipped while the lobby already has an open proposal ----------
const lobbyB = "lobby-b";
roomState.set(lobbyB, "open");
roomState.set("child-b1", "concluded");
roomState.set("child-b2", "concluded");
spawner.request({ room: lobbyB, requestedBy: "lobby-seat-b", brief, count: 2, newRoom: "child-b1", parentTopic: "rank the lobby list" });
openProposal.add(lobbyB);
spawner.checkConsolidators();
assert.equal(consolidators(lobbyB).length, 0, "skipped while a proposal is open in the lobby");
openProposal.delete(lobbyB);
spawner.checkConsolidators();
assert.equal(consolidators(lobbyB).length, 1, "fires once the open proposal is gone");
spawner.checkConsolidators();
assert.equal(consolidators(lobbyB).length, 1, "still never fires twice");

// ---------- 7. Unknown lobby state (room does not exist): skip, do not fire into nothing ----------
const lobbyC = "lobby-c";
roomState.set("child-c1", "concluded");
roomState.set("child-c2", "concluded");
spawner.request({ room: lobbyC, requestedBy: "lobby-seat-c", brief, count: 2, newRoom: "child-c1", parentTopic: "rank the lobby list" });
spawner.checkConsolidators();
assert.equal(consolidators(lobbyC).length, 0, "no consolidator when the lobby room state is unknown");

// ---------- 8. Child room concluded while its seat process is still alive: no close event ever fires ----------
// heartbeat-as-liveness keeps the seat process up and the idle sweep away, so the ONLY trigger is the
// hub-side room-concluded event; process exit must not be part of the gate (lobby review finding).
const lobbyD = "lobby-d";
roomState.set(lobbyD, "open");
roomState.set("child-d1", "concluded");
roomState.set("child-d2", "concluded");
const recsD = spawner.request({ room: lobbyD, requestedBy: "lobby-seat-d", brief, count: 2, newRoom: "child-d1", parentTopic: "rank the lobby list" });
const dim = spawner as unknown as { agents: SpawnedAgent[] };
for (const r of recsD) dim.agents.find((a) => a.name === r.name)!.endedAt = undefined; // process still alive after conclusion
spawner.checkConsolidators(); // this is what hub.onRoomState("concluded") invokes
assert.equal(consolidators(lobbyD).length, 1, "a concluded child room with a still-alive seat process must still spawn exactly one consolidator");
spawner.checkConsolidators();
assert.equal(consolidators(lobbyD).length, 1, "and it still never fires twice");

console.log("CONSOLIDATOR-SPAWN OK");
