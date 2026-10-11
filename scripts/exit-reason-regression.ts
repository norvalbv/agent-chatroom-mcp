/** A seat stopped by its account's usage limit, or by a compaction window too small for what it reads, was announced
 * as "seat process exited (exit 1, launcher receipt)": the reason and the reset time were only in the seat's output
 * file (swarm-003601-tky5 #139-#146, three seats at 00:56 UTC; dev room swarm-005342-qejc). This pins that the exit
 * receipt carries them. Pure functions: no subprocess, no network.
 * Run: npx tsx scripts/exit-reason-regression.ts
 */
import assert from "node:assert/strict";

const mod = await import("../src/respawn.js").catch(() => null);
assert.equal(typeof mod?.exitDetail, "function", "src/respawn.ts exports exitDetail");
const { exitDetail, usageLimit } = mod;

const now = Date.parse("2026-10-11T00:56:42.000Z"); // 01:56 in London (UTC+1 until 25 October)
assert.equal(exitDetail(1, "You've hit your session limit · resets 2:10am (Europe/London)", now), "exit 1: usage limit, resets 01:10 UTC");
assert.equal(exitDetail(1, "some earlier text\nYou've hit your session limit · resets 2:10am (Europe/London)\n", now), "exit 1: usage limit, resets 01:10 UTC");
// a reset time already past today means tomorrow; an hour with no minutes; another zone
assert.deepEqual(usageLimit("You've hit your session limit · resets 1am (Europe/London)", now), { resetsAt: "2026-10-12T00:00:00.000Z" });
assert.deepEqual(usageLimit("You've hit your weekly limit · resets 9:30pm (America/New_York)", now), { resetsAt: "2026-10-11T01:30:00.000Z" });
// the limit named without a time we can read is still the reason
assert.equal(exitDetail(1, "You've hit your session limit", now), "exit 1: usage limit");
assert.equal(exitDetail(1, "You've hit your session limit · resets soon (Nowhere/Zone)", now), "exit 1: usage limit");
assert.equal(exitDetail(1, "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row.", now), "exit 1: compaction thrashing, the compact window is too small for what the seat reads");
// anything else is what it was
assert.equal(exitDetail(1, "TypeError: x is not a function", now), "exit 1");
assert.equal(exitDetail(0, "CONCLUSION: done. Earlier a seat said: You've hit your session limit", now), "exit 0", "a clean exit is not relabelled by what its text quotes");
assert.equal(exitDetail(null, "", now), "exit null");
assert.equal(usageLimit("all good", now), null);
assert.ok(exitDetail(1, "x".repeat(5000) + "You've hit your session limit · resets 2:10am (Europe/London)", now).length <= 80, "fits the hub's 80-character receipt");
console.log("EXIT REASON OK");
