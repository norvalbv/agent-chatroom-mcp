/**
 * The pre-propose check in a require_verification room ignores verify/<area>.partial keys, which can never count
 * (verifyEntryVerdict skips them; the recruit prompt says a .partial "does not count"). Found live by a real recruit in
 * swarm-000525-jcz8 (#268). Round 1's fix (6334c88f) also refused prose verify entries with no JSON head, broke four
 * suite tests that rely on that habit (240 in past logs) and was reverted; this rebuild excludes ONLY .partial keys
 * (swarm-082539-kns2, claim/verification; remaining/recruiting item 0). Whether a proposal PASSES is untouched.
 * Run: npx tsx --test scripts/partial-pregate-regression.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const TEXT = "The cache makes reads faster in scripts/bench.ts.";
const HEAD = JSON.stringify({ proposal: "pending", command: "npm test", cwd: ".", base_commit: "aaaaaaa", base_exit_code: 1, commit: "bbbbbbb", exit_code: 0, output_tail: "ok" });

function setup(requireVerification: boolean) {
  const hub = new Hub({});
  const R = `partial-pregate-${requireVerification}-${Math.random().toString(36).slice(2, 8)}`;
  const { participant: a } = hub.join(R, "A", "test", { requireVerification, requireChallenge: true }, undefined, "s1");
  hub.join(R, "B", "test", {}, undefined, "s2");
  return { hub, R, a };
}

test("(a) only verify/x.partial on the board: propose is refused, and the refusal says why", () => {
  const { hub, R, a } = setup(true);
  hub.setBoard(R, a.id, "verify/x.partial", `${HEAD}\nverified nothing yet`);
  assert.throws(() => hub.propose(R, a.id, TEXT), /This room requires verification: before proposing[\s\S]*verify\/x\.partial[\s\S]*\.partial never counts/);
});

test("(b) a head-less prose verify/x still lets propose through (round 1's revert: 4 suite tests rely on it)", () => {
  const { hub, R, a } = setup(true);
  hub.setBoard(R, a.id, "verify/x", "I ran npm test and it passed.");
  assert.equal(hub.propose(R, a.id, TEXT).status, "open");
});

test("(c) a .partial next to a real verify/x: propose is accepted", () => {
  const { hub, R, a } = setup(true);
  hub.setBoard(R, a.id, "verify/x.partial", "nothing verified");
  hub.setBoard(R, a.id, "verify/x", `${HEAD}\nran it`);
  assert.equal(hub.propose(R, a.id, TEXT).status, "open");
});

test("(d) a room without require_verification is unaffected", () => {
  const { hub, R, a } = setup(false);
  hub.setBoard(R, a.id, "verify/x.partial", "nothing verified");
  assert.equal(hub.propose(R, a.id, TEXT).status, "open");
});
