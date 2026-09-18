/** node --import tsx scripts/rq1-stats.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fisherExactTest, twoProportionZTest, proportionTest } from "./rq1-stats.js";

test("fisher's exact test matches the textbook 'lady tasting tea' 2x2 table", () => {
  // [[3,1],[1,3]]: canonical two-sided p-value is 0.4857142857142857 (Fisher 1935 example;
  // reproduced in every stats textbook covering the test, independent of this implementation).
  const r = fisherExactTest(3, 1, 1, 3);
  assert.equal(r.test, "fisher");
  assert.ok(Math.abs(r.p_value! - 0.4857142857142857) < 1e-9, `got ${r.p_value}`);
});

test("fisher's exact test is symmetric under swapping rows", () => {
  const r1 = fisherExactTest(8, 2, 2, 8);
  const r2 = fisherExactTest(2, 8, 8, 2);
  assert.ok(Math.abs(r1.p_value! - r2.p_value!) < 1e-12);
});

test("fisher's exact test gives p=1 for identical proportions with small cells", () => {
  const r = fisherExactTest(2, 2, 2, 2);
  // erf/log-gamma are floating-point approximations (A&S 7.1.26, max error 1.5e-7): p=1 up to that tolerance.
  assert.ok(Math.abs(r.p_value! - 1) < 1e-6, `p=${r.p_value}`);
});

test("two-proportion z-test: 8/10 vs 2/10 is a large, significant difference", () => {
  const r = twoProportionZTest(8, 10, 2, 10);
  assert.equal(r.test, "z");
  // pooled p=0.5, se=sqrt(0.5*0.5*0.2)=0.223606797749979, z=(0.8-0.2)/se=2.683281572999748
  assert.ok(Math.abs(r.statistic! - 2.683281572999748) < 1e-9, `z=${r.statistic}`);
  assert.ok(r.p_value! < 0.01 && r.p_value! > 0.005, `p=${r.p_value}`);
});

test("two-proportion z-test: identical proportions give p=1, z=0", () => {
  const r = twoProportionZTest(5, 10, 15, 30);
  assert.equal(r.statistic, 0);
  assert.ok(Math.abs(r.p_value! - 1) < 1e-6, `p=${r.p_value}`); // erf approximation, see note above
});

test("two-proportion z-test: empty arm is undefined, not a crash", () => {
  const r = twoProportionZTest(0, 0, 5, 10);
  assert.equal(r.p_value, null);
});

test("proportionTest: routes to Fisher's exact when any cell <5 (protocol.md §5)", () => {
  const r = proportionTest(4, 1, 2, 3); // min cell is 1
  assert.equal(r.test, "fisher");
});

test("proportionTest: routes to the z-test when every cell is >=5", () => {
  const r = proportionTest(8, 5, 6, 7);
  assert.equal(r.test, "z");
});

console.log("RQ1 STATS OK");
