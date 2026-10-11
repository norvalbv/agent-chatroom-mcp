/**
 * A long run is not told to conclude after three quiet minutes. Run: npx tsx --test scripts/silence-nudge-regression.ts
 *
 * After nudgeAfterMs of silence with no proposal open the hub posts "N min of silence. If the discussion has converged,
 * X should propose a conclusion." That fits a 20-minute debate. The Polymarket room (8 hours, brief: "do not wrap up
 * early") got it 6 times, and in the dress rehearsal of the grouped launch (swarm-013051-mgzm, hub 7857) it fired in
 * all three rooms while both groups were correctly waiting for late data: a group that concludes can take no more
 * digests. The hub already knows a long run from the deadline its launcher posts. Covers: a room whose run is
 * LONG_RUN_MS or more from when the deadline was set, and has not been told it is ending, is not sent that line; a
 * short run and a room with no deadline keep it; once the end has been announced the line is back (propose now is then
 * right); the other two silence lines (an open proposal's blockers, openings still owed) are untouched.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const NUDGE = /min of silence\. If the discussion has converged/;
const NUDGE_MS = 40;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function room2(name: string) {
  const hub = new Hub({});
  const a = hub.join(name, "A", "claude", { requireChallenge: false, nudgeAfterMs: NUDGE_MS, expectedParticipants: 0 }, undefined, `s-${name}-A`).participant;
  const b = hub.join(name, "B", "claude", {}, undefined, `s-${name}-B`).participant;
  return { hub, room: hub.getRoom(name), a, b };
}
const nudges = (hub: Hub, name: string) => hub.getRoom(name).messages.filter((m) => m.from.id === "system" && NUDGE.test(m.content));
const inMin = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

test("a short room, and a room with no deadline, are still nudged to propose", async () => {
  const none = room2("nudge-none");
  none.hub.send("nudge-none", none.a.id, "the count is 12", undefined, true);
  const short = room2("nudge-short");
  short.hub.setDeadline("nudge-short", inMin(20));
  short.hub.send("nudge-short", short.a.id, "the count is 12", undefined, true);
  await wait(NUDGE_MS * 4);
  assert.equal(nudges(none.hub, "nudge-none").length >= 1, true, "no deadline: as before");
  assert.equal(nudges(short.hub, "nudge-short").length >= 1, true, "a 20-minute run: as before");
});

test("a long run is not told to propose after a quiet spell, until its end has been announced", async () => {
  assert.equal(Hub.LONG_RUN_MS, 60 * 60_000);
  const { hub, room, a } = room2("nudge-long");
  hub.setDeadline("nudge-long", inMin(8 * 60));
  hub.send("nudge-long", a.id, "waiting on the 14:00 close", undefined, true);
  await wait(NUDGE_MS * 4);
  assert.equal(nudges(hub, "nudge-long").length, 0, "8 hours to run: silence is not convergence");

  // the hub has told the room it is ending: now "propose" is the right thing to say
  room.deadline!.announced = true;
  hub.send("nudge-long", a.id, "table is final", undefined, true);
  await wait(NUDGE_MS * 4);
  assert.equal(nudges(hub, "nudge-long").length >= 1, true, "after the deadline line the nudge is back");
});

test("the other silence lines are untouched in a long run: an open proposal still names what blocks it", async () => {
  const { hub, a } = room2("nudge-proposal");
  hub.setDeadline("nudge-proposal", inMin(8 * 60));
  const pr = hub.propose("nudge-proposal", a.id, "The rule fails on held-out data at every bankroll we tried.");
  await wait(NUDGE_MS * 4);
  assert.equal(hub.getRoom("nudge-proposal").messages.some((m) => m.from.id === "system" && m.content.includes(`Proposal ${pr.id}`) && /min of silence/.test(m.content)), true);
});
