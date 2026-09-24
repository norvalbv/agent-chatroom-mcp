/** Study 3 table and direction count: node --import tsx scripts/paper-pool-throughput.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { summarise } from "./paper-pool-throughput.ts";
import type { PoolRunRecord } from "./pool-results-export.ts";

const rec = (pool: string, arm: string, rep: number, passed: number, extra: Partial<PoolRunRecord> = {}): PoolRunRecord => ({
  pool, pool_sha256: "x", arm, rep, status: rep >= 90 ? "pilot" : "counted", void_reason: null, model: "m", deadline_min: 30,
  started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:10:00Z", minutes: 10, stopped_at_deadline: false, passed, of: 20,
  attempted: passed, items: [], suite_pass: true, conflicts: 0, missing_branches: 0, cost_usd: passed, cost_estimated: false,
  account: 1, audit_hits: 0, ...extra,
});
const pool = (name: string, means: Record<string, [number, number]>) => Object.entries(means).flatMap(([arm, [a, b]]) => [rec(name, arm, 1, a), rec(name, arm, 2, b)]);

test("a difference of 3 or more in the predicted direction in two pools supports; the opposite contradicts; no difference leaves it unsupported", () => {
  const records = [
    ...pool("hub", { solo: [10, 10], split: [14, 14], room3: [20, 20], room15: [20, 20] }),
    ...pool("game", { solo: [10, 10], split: [13, 13], room3: [18, 18], room15: [19, 19] }),
  ];
  const s = summarise(records);
  const v = Object.fromEntries(s.directions.map((d) => [d.n, d.verdict]));
  assert.equal(v[1], "supported", "split beat solo by 4 and 3");
  assert.equal(v[2], "contradicted", "room3 beat split by 6 and 5 where no difference was predicted");
  assert.equal(v[3], "not supported", "room15 and room3 within 3 in both pools");
});

test("a pool missing a repeat gives no direction; pilots and voided runs are never counted", () => {
  const records = [
    ...pool("hub", { solo: [20, 20], split: [15, 15], room3: [20, 20], room15: [20, 20] }),
    rec("frink", "split", 2, 20), rec("frink", "solo", 90, 18),
    rec("hub", "room15", 2, 0, { status: "void", void_reason: "argv-pkill" }),
  ];
  const s = summarise(records);
  assert.equal(s.cells.frink.split.mean, null);
  assert.equal(s.cells.frink.split.cost_per_passing_item, 1);
  assert.equal(s.cells.hub.room15.mean, 20, "the voided run is not counted");
  assert.ok(s.directions.every((d) => d.per_pool.find((p) => p.pool === "frink")?.direction === "incomplete"));
  assert.deepEqual(s.pilots_and_voided.map((r) => r.status).sort(), ["pilot", "void"]);
  assert.deepEqual(s.incomplete_pools, ["game", "frink"]);
});
