/** The launcher's pre-launch cost guide: node --import tsx scripts/launch-cost-guide.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { launchCostGuide, OPUS_USD_PER_SEAT_MINUTE } from "../src/cost-estimate.ts";

test("the guide scales with seats x minutes at the pool study's measured Opus rates", () => {
  const four = launchCostGuide(4, 30);
  assert.match(four, /4 seat\(s\) x up to 30 min/);
  assert.match(four, /about \$21 \(range \$8-\$48\)/, "4 x 30 x 0.173 = 20.8; 0.068 -> 8.2; 0.399 -> 47.9");
  const fifteen = launchCostGuide(15, 30);
  assert.match(fifteen, /about \$78 \(range \$31-\$180\)/, "15 x 30 x 0.173 = 77.9");
});

test("the rates are the Study 3 minimum, median and maximum, in order", () => {
  const r = OPUS_USD_PER_SEAT_MINUTE;
  assert.ok(r.low < r.median && r.median < r.high);
  assert.match(launchCostGuide(1, 1), /\$0\.07-\$0\.40 per seat-minute/);
});
