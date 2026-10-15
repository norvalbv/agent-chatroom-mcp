/** A seat's transcript is re-read on every request, so the launcher can cap it: --compact-at <tokens> reaches every
 * Claude seat and recruit as Claude Code's CLAUDE_CODE_AUTO_COMPACT_WINDOW (swarm-094251-5y46: contexts of 0.45-0.9M
 * tokens, cache read 65% of $296). Pure functions only: no subprocess, no network.
 * Run: npx tsx scripts/seat-compact-window-regression.ts
 */
import assert from "node:assert/strict";
import * as env from "../src/env.js";

const compactWindow = (env as any).compactWindow as ((raw: string | undefined) => number | null) | undefined;
assert.equal(typeof compactWindow, "function", "src/env.ts exports compactWindow");
assert.equal(compactWindow!("200000"), 200000);
assert.equal(compactWindow!(undefined), null, "unset: Claude Code's own default");
// Claude Code reads "200k" as 200 and clamps it to its 100K minimum: refuse rather than compact twice as often as asked
for (const bad of ["200k", "", "abc", "99999", "1000001", "150000.5", "-200000"]) assert.equal(compactWindow!(bad), null, `"${bad}" is not a window`);

const base = { PATH: "/bin", CHATROOM_SEAT_KEY: "k" };
assert.equal(env.seatChildEnv({ ...base, CHATROOM_SEAT_COMPACT_WINDOW: "200000" }).CLAUDE_CODE_AUTO_COMPACT_WINDOW, "200000", "the seat's Claude Code gets the window");
assert.equal(env.seatChildEnv({ ...base }).CLAUDE_CODE_AUTO_COMPACT_WINDOW, "300000", "no flag: the lean default (scripts/seat-compact-default-regression.ts)");
assert.equal(env.seatChildEnv({ ...base, CHATROOM_SEAT_COMPACT_WINDOW: "200k" }).CLAUDE_CODE_AUTO_COMPACT_WINDOW, "300000", "a bad value is dropped, not passed on: the default applies");
assert.equal(env.seatChildEnv({ ...base, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" }).CLAUDE_CODE_AUTO_COMPACT_WINDOW, "500000", "the operator's own setting survives when the launcher sets none");
assert.equal(env.seatChildEnv({ ...base, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000", CHATROOM_SEAT_COMPACT_WINDOW: "200000" }).CLAUDE_CODE_AUTO_COMPACT_WINDOW, "200000", "the launcher's flag wins over an inherited setting");
assert.equal((env as any).COMPACT_WINDOW_TESTED, 200000, "the launcher warns under the smallest window a dev room ran through");
console.log("SEAT COMPACT WINDOW OK");
