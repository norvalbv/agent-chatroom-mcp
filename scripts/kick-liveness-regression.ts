/**
 * A kick vote says what the hub itself knows about whether its target is alive (evidence-pack item 6; chat-and-friction
 * 8). Run: npx tsx scripts/kick-liveness-regression.ts
 *
 * swarm-205034-nkli #113: the owner opened a kick vote on claude-opus-5-5-5 as "dead agent" while its process was
 * running and writing results; 3 of 5 seats had just died on a usage limit, so the vote needed only 2 ballots, and only
 * the chair's manual pid check (#119) stopped it. The announcement carried the seat's board record and no liveness,
 * though the hub had the seat's last tool step from its heartbeat hook.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const dataDir = mkdtempSync(join(tmpdir(), "kick-liveness-"));
let failed = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
};
const hub = new Hub({ dataDir });
const R = "kick-live";
hub.join(R, "seat-1", "claude", { expectedParticipants: 3 }, undefined, "s1");
const busy = hub.join(R, "seat-5", "claude", {}, undefined, "s5").participant;
hub.join(R, "seat-2", "claude", {}, undefined, "s2");
const owner = hub.join(R, "benji", "human", {}, undefined, "http:benji").participant;
// seat-5 is heads-down in a long command: its heartbeat hook reports the step, it has said nothing for a while
hub.heartbeat(R, busy.id, { tool: "Bash", step: 412, detail: "python h1rep.py --intent-only > /tmp/h5/h1rep/v-C.jsonl" });
const room = hub.getRoom(R);

check("the vote's opening line says the target is working now, with its current step", () => {
  hub.kickVote(R, owner.id, "seat-5", "kick", "dead agent");
  const line = room.messages.filter((m) => m.kind === "system" && /started a vote to kick seat-5/.test(m.content)).at(-1)?.content ?? "";
  assert.match(line, /seat-5 is working now by the hub's own signals: last tool step \d+ s ago \(Bash: python h1rep\.py/, line.slice(0, 400));
});
check("the persisted vote carries the target's liveness at the start (telemetry: a live seat voted on as dead)", () => {
  const log = readFileSync(join(dataDir, `${R}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const kv = log.filter((e) => e.type === "kick_vote").at(-1)?.vote;
  assert.ok(kv?.targetLiveness, "kick_vote.targetLiveness is recorded");
  assert.equal(kv.targetLiveness.status, "working");
  assert.equal(kv.targetLiveness.tool, "Bash");
  assert.equal(typeof kv.targetLiveness.step_age_s, "number");
  assert.equal(typeof kv.targetLiveness.last_call_age_s, "number");
});
check("a seat with no step for 10 minutes is described as silent, not working", () => {
  const quiet = hub.join(R, "seat-9", "claude", {}, undefined, "s9").participant;
  hub.heartbeat(R, quiet.id, { tool: "Bash", step: 3, detail: "sleep 1" });
  quiet.working!.at = new Date(Date.now() - 11 * 60_000).toISOString();
  quiet.lastActiveAt = new Date(Date.now() - 11 * 60_000).toISOString();
  hub.kickVote(R, owner.id, "seat-9", "kick", "no heartbeat for 11 minutes");
  const line = room.messages.filter((m) => m.kind === "system" && /started a vote to kick seat-9/.test(m.content)).at(-1)?.content ?? "";
  assert.match(line, /seat-9 has been silent by the hub's own signals: last tool step 1[01] min ago/, line.slice(0, 400));
});
// review/23f0620d (claude-opus-5-5-4): a verifier inside one 11-minute command was "suspected_dead" in room_status from
// 601 s on, while the hub itself held the room open for it because its job was running (Hub.jobsOf)
check("a seat whose own job is running is busy, not suspected dead, in room_status and in a kick vote", () => {
  const v = hub.join(R, "verifier", "claude", {}, undefined, "sv", "verifier").participant;
  hub.heartbeat(R, v.id, { tool: "Bash", step: 40, detail: "node scripts/offline-runner.mjs" });
  v.working!.at = new Date(Date.now() - 11 * 60_000).toISOString();
  v.lastActiveAt = new Date(Date.now() - 11 * 60_000).toISOString();
  (hub as unknown as { jobsOf: (p: { id: string }) => unknown[] }).jobsOf = (p) => (p.id === v.id ? [{ pid: 4242, command: "node scripts/offline-runner.mjs", elapsed_s: 660 }] : []);
  const seen = (hub.summary(room, true) as { participants: { name: string; liveness: { status: string; job?: { pid: number } } }[] }).participants.find((p) => p.name === "verifier")!.liveness;
  assert.equal(seen.status, "busy", `room_status says ${seen.status}`);
  assert.equal(seen.job?.pid, 4242);
  const live = (hub as unknown as { kickLiveness: (p: unknown) => { status: string; job?: { pid: number } } }).kickLiveness(v);
  assert.equal(live.status, "working");
  assert.equal(live.job?.pid, 4242);
});
rmSync(dataDir, { recursive: true, force: true });
if (failed) { console.error(`KICK LIVENESS: ${failed}/4 failed`); process.exitCode = 1; } else console.log("KICK LIVENESS OK (4 cases)");
