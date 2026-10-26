/** Lean seats compact at 300000 tokens unless told otherwise (evidence/compaction-replay, swarm-092526-89rn): unset, a
 * seat runs on the model's 1M window, and in swarm-180216-182a seats re-read a mean of 341-456k tokens per request
 * (5 compactions, at ~962k); mrw4's 24 seats compacted 87 times at ~268k and sat near 150k. Replaying 182a's
 * transcripts at a 300k window puts its cache-read cost at 0.33 of actual. Pure functions only.
 * Run: npx tsx scripts/seat-compact-default-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as env from "../src/env.js";

const base = { PATH: "/bin", CHATROOM_SEAT_KEY: "k" };
const win = (e: NodeJS.ProcessEnv) => env.seatChildEnv(e, undefined, false, true).CLAUDE_CODE_AUTO_COMPACT_WINDOW;

assert.equal((env as any).SEAT_COMPACT_DEFAULT, 300000, "src/env.ts exports the lean default window");
assert.equal(win({ ...base }), "300000", "no flag: the seat compacts at the default, not at the model's 1M limit");
assert.equal(win({ ...base, CHATROOM_SEAT_COMPACT_WINDOW: "200000" }), "200000", "--compact-at still wins");
assert.equal(win({ ...base, CHATROOM_SEAT_COMPACT_WINDOW: "1000000" }), "1000000", "--compact-at 1000000 is the way back to the full window");
assert.equal(win({ ...base, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" }), "500000", "an operator's own Claude Code setting is kept");
assert.equal(win({ ...base, CHATROOM_SEAT_COMPACT_WINDOW: "off" }), undefined, "off: Claude Code's own default (what --claude-full restores)");
assert.equal(win({ ...base, CHATROOM_CLAUDE_FULL: "1" }), undefined, "CHATROOM_CLAUDE_FULL=1 recruits keep today's behaviour");
assert.equal(env.seatChildEnv({ ...base, CHATROOM_SEAT_COMPACT_WINDOW: "off" }, undefined, false, true).CHATROOM_SEAT_COMPACT_WINDOW, undefined, "the switch itself never reaches the seat");
assert.equal(env.seatChildEnv({ ...base }).CLAUDE_CODE_AUTO_COMPACT_WINDOW, undefined, "codex and OpenRouter seats get no default: they never read it (seat-env-regression's flat clone)");
assert.equal(env.seatChildEnv({ ...base }, undefined, true).CLAUDE_CODE_AUTO_COMPACT_WINDOW, undefined, "a paid OpenRouter seat neither");
for (const [file, call] of [["src/swarm.ts", 'openRouterSeats.has(name), cmd === "claude")'], ["src/spawner.ts", 'agent === "openrouter", agent === "claude")']]) {
  assert.ok(readFileSync(new URL(`../${file}`, import.meta.url), "utf8").includes(call), `${file} marks its claude seats for the default`);
}
console.log("SEAT COMPACT DEFAULT OK");
