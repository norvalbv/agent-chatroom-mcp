/** A seat stopped by the account's usage limit is respawned once the account can run a seat again, not at once into
 * the same wall; and a successor that died before it ever joined does not end the chain. In swarm-003601-tky5 the
 * limit stopped six seats at 00:56 and 01:58 UTC; in seat 1's rehearsal (evidence/survival-rehearsal) the verifier was
 * respawned in the same second, its successor died of the same limit 2 s later without joining, and the next
 * registration was refused (400: "A replacement is already registered"), so the run lost its verifier for good.
 * npx tsx scripts/respawn-usage-wait-regression.ts */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";
import * as respawn from "../src/respawn.js";

// ---- the hub: a reserved successor that never joined can be replaced by a new reservation ----
const hub = new Hub();
const room = hub.createRoom("r", { expectedParticipants: 0 });
hub.join(room.name, "verifier", "claude", {}, undefined, "s-v", "verifier");
hub.registerReplacement("r", "verifier", "verifier-r1");
const again = (() => { try { return hub.registerReplacement("r", "verifier", "verifier-r2"); } catch (e) { return e as Error; } })();
assert.ok(!(again instanceof Error), `a successor that never joined is replaced by a new one: ${again instanceof Error ? again.message : ""}`);
// ...but a successor that did join is a seat of its own: it is the one to replace
hub.join("r", "verifier-r2", "claude", { replacementToken: (again as { replacementToken: string }).replacementToken }, undefined, "s-v2");
assert.throws(() => hub.registerReplacement("r", "verifier", "verifier-r3"), /already/, "a predecessor whose successor joined is not re-reserved");

// ---- the chain ----
type Out = { code: number };
const logs: string[] = [];
const registered: [string, string][] = [];
const seated = new Set<string>(["v"]);
let clock = 0;
let usageBack = 3; // the account is out for three checks, then back
const outcomes = new Map<string, { code: number; detail: string }>([
  ["v", { code: 1, detail: "exit 1: usage limit, resets 02:20 UTC" }],
  ["v-r1", { code: 1, detail: "exit 1: usage limit, resets 02:20 UTC" }], // dies before joining
  ["v-r2", { code: 0, detail: "exit 0" }],
]);
const ran: string[] = [];
const checks: number[] = [];
const chain = await respawn.respawnChain<Out>({
  name: "v",
  maxAttempts: 2, // the room here has no live seats, so the floor rule would keep respawning a finished seat
  stop: () => false,
  room: async () => ({ state: "open", board: {}, participants: [...seated].map((name) => ({ name, agent: "claude", active: false })) } as respawn.RespawnRoom),
  exitCode: (nm) => outcomes.get(nm)!.code,
  detail: (nm) => outcomes.get(nm)!.detail,
  usageReady: async () => { checks.push(clock); return --usageBack < 0; },
  register: async (prev, nm) => { registered.push([prev, nm]); return ""; },
  run: async (nm) => { ran.push(nm); if (nm === "v-r2") seated.add(nm); return { code: outcomes.get(nm)!.code }; },
  log: (l: string) => { logs.push(l); },
  usagePollMs: 60_000,
  sleep: async (ms: number) => { clock += ms; },
});
assert.deepEqual(ran, ["v", "v-r1", "v-r2"], "the chain carries on to a successor that runs");
assert.ok(checks.length >= 3, `it waited for the account before respawning (${checks.length} checks)`);
assert.ok(clock >= 3 * 60_000, "and the waiting took the poll interval each time");
assert.deepEqual(registered.map(([p]) => p), ["v", "v"], "a successor that never joined is replaced in the name of the last seat that did");
assert.ok(logs.some((l) => /usage limit/.test(l) && /waiting/i.test(l)), `the log says it is waiting for usage: ${logs.join(" | ")}`);
assert.equal(chain.lastName, "v-r2");

// the limit stops a seat before it ever joined, before the room even exists: nothing to hand over, so after the wait it
// is started again with no replacement registration (the launcher used to stop here on "room missing")
const fresh: string[] = [];
const freshRegistered: string[] = [];
let roomExists = false;
const early = await respawn.respawnChain<Out>({
  name: "x", maxAttempts: 1, stop: () => false,
  room: async () => (roomExists ? ({ state: "open", board: {}, participants: [{ name: "x-r1", agent: "claude", active: false }] } as respawn.RespawnRoom) : null),
  exitCode: (nm: string) => (nm === "x" ? 1 : 0), detail: (nm: string) => (nm === "x" ? "exit 1: usage limit" : "exit 0"),
  usageReady: async () => true,
  register: async (prev: string) => { freshRegistered.push(prev); return ""; },
  run: async (nm: string) => { fresh.push(nm); if (nm === "x-r1") roomExists = true; return { code: nm === "x" ? 1 : 0 }; },
  usagePollMs: 1, sleep: async () => {},
});
assert.deepEqual(fresh, ["x", "x-r1"], "a seat stopped before the room existed is started again after the wait");
assert.deepEqual(freshRegistered, [], "with no replacement registration, since it never held a seat");
assert.equal(early.lastName, "x-r1");

// a launcher that is stopping does not wait for usage
const stopLogs: string[] = [];
const stopped = await respawn.respawnChain<Out>({
  name: "w", stop: () => stopLogs.length > 0, room: async () => ({ state: "open", board: {}, participants: [{ name: "w", agent: "claude", active: false }] } as respawn.RespawnRoom),
  exitCode: () => 1, detail: () => "exit 1: usage limit", usageReady: async () => false,
  register: async () => "", run: async () => ({ code: 1 }), log: (l: string) => stopLogs.push(l), usagePollMs: 1, sleep: async () => {},
});
assert.equal(stopped.lastName, "w", "no successor once the launcher stops while waiting");
console.log("RESPAWN USAGE WAIT REGRESSION OK");
