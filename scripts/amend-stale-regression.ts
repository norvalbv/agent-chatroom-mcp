/**
 * A stale find is told what changed (evidence-pack item 3; idea/amend-stale-find, claim/amend-board-entry part 2).
 * 20 of 61 refused amends in 15 rooms since 2026-10-10 came within 30 s of another seat's successful amend of the same
 * proposal (/tmp/c1/amend.mjs: gwhf 5, 00cp 3, pmyh 3, ouev 2, mrkt 2 ...): the find was copied from version N and the
 * text was already N+1. The refusal said only that the find "does not occur", and 9 of the 61 were ever followed by a
 * successful amend. Now a find that was in the previous version is refused with its own code, amend-stale, naming who
 * changed it and quoting what that passage reads now, so the retry is one call and contention is countable.
 * Red on main: the refusal is amend-find and names nobody.
 * Run: npx tsx scripts/amend-stale-regression.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub, HubError } from "../src/hub.js";
import { REFUSAL_CODES } from "../src/hub/types.js";

const TEXT = "Remove the gate from devkit. Keep the --no-qavis-publish flag for one release as a no-op. Build no replacement gate, and record the decision in docs.";

function setup(room: string) {
  Hub.LAST_CALL_MS = 0;
  const hub = new Hub();
  const a = hub.join(room, "A", "test", { nudgeAfterMs: 0, requireChallenge: false }, undefined, "s1").participant;
  const b = hub.join(room, "B", "test", {}, undefined, "s2").participant;
  const c = hub.join(room, "C", "test", {}, undefined, "s3").participant;
  const pr = hub.propose(room, a.id, TEXT);
  return { hub, a, b, c, pr };
}
const refusal = (fn: () => unknown): HubError => { try { fn(); } catch (e) { if (e instanceof HubError) return e; throw e; } throw new Error("expected a refusal"); };

test("a find that another seat's amend just replaced is refused as stale, with who and what it reads now", () => {
  const { hub, b, c, pr } = setup("as-room");
  hub.amend("as-room", b.id, pr.id, "for one release as a no-op", "for two releases, warning when it is passed");
  const e = refusal(() => hub.amend("as-room", c.id, pr.id, "for one release as a no-op", "for one release as a no-op that logs a deprecation line"));
  assert.equal(e.code, "amend-stale", "its own code, so contention can be counted apart from a mistyped find");
  assert.ok((REFUSAL_CODES as readonly string[]).includes("amend-stale"), "and the code is in the closed list");
  assert.match(e.message, /\bB\b/, "it names who changed the passage");
  assert.match(e.message, /v1/, "and which version the find came from");
  assert.match(e.message, /for two releases, warning when it is passed/, "and quotes what that passage reads now");
  assert.ok(e.message.length < 900, "without the whole proposal");
  // the retry against the quoted text is one call
  hub.amend("as-room", c.id, pr.id, "for two releases, warning when it is passed", "for two releases, logging a deprecation line when it is passed");
  assert.equal(pr.version, 3);
});

test("a find that was never in the text is still amend-find; a stale find after replace_all says the text was rewritten", () => {
  const { hub, b, c, pr } = setup("as-other");
  assert.equal(refusal(() => hub.amend("as-other", c.id, pr.id, "this passage was never in it", "x")).code, "amend-find");
  hub.amend("as-other", b.id, pr.id, "", "A wholly new answer: keep the gate and fix its false positives instead.", true);
  const e = refusal(() => hub.amend("as-other", c.id, pr.id, "Build no replacement gate", "Build no replacement gate this quarter"));
  assert.equal(e.code, "amend-stale");
  assert.match(e.message, /\bB\b/);
  assert.match(e.message, /keep the gate and fix its false positives/, "the rewritten text is short enough to quote");
});
