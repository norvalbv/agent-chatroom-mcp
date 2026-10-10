/**
 * The pre-propose check in a require_verification room must count only verify/* entries that could ever count: not a
 * verify/<area>.partial (the recruit prompt says it "does not count") and not one whose first line is no JSON verify
 * head. At 118afcb7 any key starting "verify/" let propose through. Whether a proposal PASSES is decided elsewhere
 * (verifyEntryVerdict) and is not touched here.
 * Run: npx tsx scripts/partial-pregate-regression.ts
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

test("(a) only verify/x.partial on the board: propose is refused", () => {
  const { hub, R, a } = setup(true);
  hub.setBoard(R, a.id, "verify/x.partial", `${HEAD}\nverified nothing`);
  assert.throws(() => hub.propose(R, a.id, TEXT), /This room requires verification: before proposing.*\.partial/s);
});

test("(b) only a head-less verify/x (prose) on the board: propose is refused", () => {
  const { hub, R, a } = setup(true);
  hub.setBoard(R, a.id, "verify/x", "I ran npm test and it passed.");
  assert.throws(() => hub.propose(R, a.id, TEXT), /This room requires verification: before proposing.*first line/s);
});

test("(c) a verify/x with a valid JSON head: propose is accepted", () => {
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
