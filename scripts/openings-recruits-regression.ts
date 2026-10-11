/**
 * A recruit never owes a blind opening (evidence/rehearsal-groups, evidence-pack item 7). Run: npx tsx scripts/openings-recruits-regression.ts
 *
 * In a grouped run's leads room (expected = groups + 1) each consolidator pass joins for about a minute as role
 * "recruit". The openings round counted it as an arrival and as owing an opening: "Openings deadline: still waiting for
 * digest-1, 1 more participant(s) to join", then "revealed on the 3 min deadline without one from digest-2" (dev run
 * swarm-194527-ofv7). The round is the founding seats' independent first answers; a seat recruited into the room is
 * not one of them, and it may still submit one.
 */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

let failed = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
};
const leadsRoom = () => {
  const hub = new Hub({});
  hub.createRoom("leads", { expectedParticipants: 3 });
  const v = hub.join("leads", "verifier", "claude", {}, undefined, "sv", "verifier").participant;
  const room = hub.getRoom("leads");
  return { hub, v, room };
};
check("a consolidator recruit is neither an arrival nor owed an opening", () => {
  const { hub, v, room } = leadsRoom();
  hub.submitOpening("leads", v.id, "Verifier: I rerun score.py myself and rule on what the groups send.");
  hub.join("leads", "digest-1", "claude", {}, undefined, "sd1", "recruit");
  const waiting = hub.openingsWaitingOn(room);
  assert.ok(!waiting.includes("digest-1"), `digest-1 is not owed an opening: ${waiting.join(", ")}`);
  assert.ok(waiting.includes("2 more participant(s) to join"), `both leads are still expected: ${waiting.join(", ")}`);
  assert.equal(room.openingsRevealed ?? false, false);
});
check("the round reveals when the founding seats are in, whatever the recruits did", () => {
  const { hub, v, room } = leadsRoom();
  hub.submitOpening("leads", v.id, "Verifier: I rerun score.py myself and rule on what the groups send.");
  hub.join("leads", "digest-1", "claude", {}, undefined, "sd1", "recruit");
  const l1 = hub.join("leads", "build-lead", "claude", {}, undefined, "sl1").participant;
  const l2 = hub.join("leads", "break-lead", "claude", {}, undefined, "sl2").participant;
  hub.submitOpening("leads", l1.id, "Build: the rule passes on tune; we claim it passes on test.");
  hub.submitOpening("leads", l2.id, "Break: the edge is luck; we claim it fails on test.");
  assert.equal(room.openingsRevealed, true, `revealed once the three founding seats have opened (waiting: ${hub.openingsWaitingOn(room).join(", ")})`);
});
check("a recruit may still submit an opening, and it is kept", () => {
  const { hub, room } = leadsRoom();
  const d = hub.join("leads", "digest-1", "claude", {}, undefined, "sd1", "recruit").participant;
  assert.doesNotThrow(() => hub.submitOpening("leads", d.id, "Digest pass 1: nothing to carry yet."));
  assert.ok(room.openings.has(d.id));
});
if (failed) { console.error(`OPENINGS RECRUITS: ${failed}/3 failed`); process.exitCode = 1; } else console.log("OPENINGS RECRUITS OK (3 cases)");
