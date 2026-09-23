/** node --import tsx scripts/stamp-adjudication-replay.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { disputedTokens, majority } from "./stamp-adjudication-replay.js";

test("disputedTokens aligns answers of different lengths instead of marking everything after a dropped value", () => {
  const [a, b] = disputedTokens(["1 2 3 4 5", "1 3 4 9"]);
  assert.deepEqual([...a].sort(), [1, 4], "a's extra 2 and its 5 differ");
  assert.deepEqual([...b].sort(), [3], "b only differs at its 9; 3 and 4 still line up");
  const same = disputedTokens(["7 7", "7 7"]);
  assert.deepEqual(same.map((s) => s.size), [0, 0]);
});

test("majority needs more than half the votes, so a split judge gives no verdict", () => {
  assert.equal(majority(["x", "x", "y", "x"]), "x");
  assert.equal(majority(["x", "x", "y", "y"]), null);
  assert.equal(majority([null, null, null, "x"]), null, "NONE votes win as no verdict");
  assert.equal(majority([]), null);
});
