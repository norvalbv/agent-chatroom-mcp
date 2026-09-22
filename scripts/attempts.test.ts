/** Offline: src/attempts.ts selection and routing rules (no claude, no git). */
import assert from "node:assert/strict";
import { pickWinner, planAttempts, type AttemptResult } from "../src/attempts.js";

const r = (index: number, passed: boolean, ran = true): AttemptResult => ({ index, branch: `b${index}`, dir: `d${index}`, ran, passed, check_exit: passed ? 0 : 1, cost_usd: null });

// the check decides, not agreement: one passing minority attempt beats two agreeing failures
assert.equal(pickWinner([r(1, false), r(2, true), r(3, false)])?.index, 2);
// lowest index among passes, regardless of input order
assert.equal(pickWinner([r(3, true), r(1, true), r(2, false)])?.index, 1);
// nothing passed: no winner, never a guess
assert.equal(pickWinner([r(1, false), r(2, false)]), null);
// an attempt whose claude run failed does not win even if the check happens to pass on the untouched tree
assert.equal(pickWinner([r(1, true, false), r(2, false)]), null);

// no check: refused with the one-agent rule
const noCheck = planAttempts({ n: 3 });
assert.equal(noCheck.ok, false);
assert.match(noCheck.ok ? "" : noCheck.reason, /run one agent/);
assert.equal(planAttempts({ n: 3, check: "   " }).ok, false);
assert.equal(planAttempts({ n: 0, check: "npm test" }).ok, false);
assert.deepEqual(planAttempts({ n: 3, check: "npm test" }), { ok: true, n: 3 });

console.log("attempts.test: OK");
