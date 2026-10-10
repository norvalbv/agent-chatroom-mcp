/** A replaced attempt's usage stays in the run total: withRespawn used to hand back only the last attempt, so a
 * crashed seat's cost vanished and the rollup still read "coverage: complete". npx tsx scripts/respawn-usage-regression.ts */
import assert from "node:assert/strict";
import * as respawn from "../src/respawn.js";
import { rollupUsage, type SeatUsageRollup } from "../src/result.js";

assert.equal(typeof (respawn as Record<string, unknown>).respawnChain, "function", "respawn.ts exports respawnChain");
const { respawnChain } = respawn;
type Outcome = { text: string; usage: SeatUsageRollup | null };
const room: respawn.RespawnRoom = { state: "open", participants: [{ name: "w1", agent: "claude", role: "worker", active: false }], board: {} };
const exits: Record<string, number | null> = { w1: 1, "w1-r1": 1, "w1-r2": 0 };
const usage: Record<string, SeatUsageRollup | null> = { w1: { cost: 2 }, "w1-r1": null, "w1-r2": { cost: 0.5 } };
const launched: string[] = [];
const chain = await respawnChain<Outcome>({
  name: "w1",
  stop: () => false,
  room: async () => ({ ...room, participants: [...room.participants, ...Array.from({ length: 4 }, (_, i) => ({ name: `u${i}`, agent: "claude", role: "worker", active: true }))] }),
  exitCode: (name) => exits[name] ?? null,
  register: async (previous, name) => ` replaces ${previous} as ${name}`,
  run: async (name, note) => { launched.push(name + note); return { text: name, usage: usage[name] }; },
});
assert.deepEqual(launched, ["w1", "w1-r1 replaces w1 as w1-r1", "w1-r2 replaces w1-r1 as w1-r2"]);
assert.equal(chain.lastName, "w1-r2");
assert.equal(chain.last.text, "w1-r2");
assert.deepEqual(chain.replaced.map((r) => r.name), ["w1", "w1-r1"], "every replaced attempt is handed back by its process name");
// the launcher rolls up the last attempt plus every replaced one: the crashed first attempt's $2 is counted,
// and the attempt that reported nothing makes coverage partial rather than complete
const total = rollupUsage([chain.last, ...chain.replaced.map((r) => r.outcome)])!;
assert.equal(total.cost_usd, 2.5);
assert.equal(total.seats, 3);
assert.equal(total.coverage, "partial");
// no respawn when the seat is stopped by signal, when stop() says so, or when registration is refused
const once = async (over: Partial<Parameters<typeof respawnChain<Outcome>>[0]>) => (await respawnChain<Outcome>({ name: "w1", stop: () => false, room: async () => room, exitCode: () => 1, register: async () => "", run: async (name) => ({ text: name, usage: null }), maxAttempts: 1, ...over }));
assert.equal((await once({ exitCode: () => 143 })).replaced.length, 0);
assert.equal((await once({ stop: () => true })).replaced.length, 0);
assert.equal((await once({ register: async () => { throw new Error("refused"); } })).replaced.length, 0);
assert.equal((await once({})).replaced.length, 1, "bounded by maxAttempts");
console.log("RESPAWN USAGE REGRESSION OK");
