/**
 * A cache reset is not work (board evidence/cache-rewrites-mrw4, swarm-092526-89rn). In swarm-130459-mrw4, 36% of all
 * cache-write tokens (17.1M, ~$107 of $958) came in 5 bursts in which nearly every live seat rewrote its whole context
 * within minutes, 4 of them at a cswap cross-org account switch. run-metrics showed them only as cost, so a reader took
 * them for work. cacheResets() names each burst: when, how many of the live seats, the tokens and their $.
 * A seat's cache writes are all 1-hour-TTL writes, so a rewrite is priced at the snapshot's 1h rate ($8/M for Opus 5.5),
 * not the 5-minute $6.25/M it first used, which understated resets by 22% (idea/cache-ttl-5m, swarm-092526-89rn).
 * Run: npx tsx scripts/cache-reset-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cacheResets, renderCacheResets } from "../src/metrics/cache-reset.js";

type Ev = Record<string, any>;

const cases: [string, () => void][] = [];
const test = (name: string, run: () => void) => cases.push([name, run]);

const prices = JSON.parse(readFileSync(new URL("./litellm-model-prices.json", import.meta.url), "utf8"));
const WRITE_1H_PER_M = prices["claude-opus-5-5"].cache_creation_input_token_cost_above_1hr * 1e6;
const usd = (tokens: number) => Math.round((tokens * WRITE_1H_PER_M) / 10_000) / 100;

const T0 = Date.parse("2026-10-14T13:30:00Z");
/** cumulative usage samples for one seat: [minute, requests, cache writes] */
function seat(id: string, samples: [number, number, number][], room = "r1"): Ev[] {
  return samples.map(([min, requests, write]) => ({
    type: "usage", room, seat: id,
    usage: { requests, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: write, at: new Date(T0 + min * 60_000).toISOString() },
  }) as Ev);
}
const byTime = (evs: Ev[]) => evs.sort((a, b) => Date.parse(a.usage.at) - Date.parse(b.usage.at));

test("two of three live seats rewriting ~150k within 5 min is one burst, with its tokens and $", () => {
  const evs = byTime([
    ...seat("a", [[0, 10, 200_000], [2, 11, 210_000], [6, 12, 360_000], [8, 13, 365_000]]),
    ...seat("b", [[0, 10, 200_000], [3, 11, 205_000], [7, 12, 355_000], [9, 13, 360_000]]),
    ...seat("c", [[0, 10, 200_000], [4, 11, 204_000], [8, 12, 210_000]]),
  ]);
  const r = cacheResets(evs);
  assert.equal(r.bursts.length, 1);
  const [x] = r.bursts;
  assert.equal(x.seats, 2);
  assert.equal(x.liveSeats, 3);
  assert.equal(x.rewriteTokens, 300_000);
  assert.equal(x.costUsd, usd(300_000)); // 300k at the 1h write rate: $2.40
  assert.equal(x.from, new Date(T0 + 6 * 60_000).toISOString());
  assert.equal(r.rewriteTokens, 300_000);
  assert.match(renderCacheResets(r), /13:36-13:37: 2 of 3 live seats.*300k.*\$2\.40/);
});

test("one seat rewriting alone is not a reset (a compaction or a cache expiry is that seat's own)", () => {
  const evs = byTime([
    ...seat("a", [[0, 10, 200_000], [6, 11, 360_000]]),
    ...seat("b", [[0, 10, 200_000], [6, 11, 205_000]]),
    ...seat("c", [[0, 10, 200_000], [6, 11, 204_000]]),
  ]);
  assert.equal(cacheResets(evs).bursts.length, 0);
});

test("rewrites 20 min apart are not one burst; a big write spread over many requests is not a rewrite", () => {
  const evs = byTime([
    ...seat("a", [[0, 10, 200_000], [5, 11, 360_000]]),
    ...seat("b", [[0, 10, 200_000], [25, 11, 355_000]]),
    ...seat("c", [[0, 10, 200_000], [5, 30, 400_000], [25, 31, 401_000]]),
  ]);
  assert.equal(cacheResets(evs).bursts.length, 0);
});

test("a respawned seat (counters back to zero) is not a rewrite; seats of every given log share one pool", () => {
  const evs = byTime([
    ...seat("a", [[0, 10, 200_000], [6, 2, 150_000]]),
    ...seat("b", [[0, 10, 200_000], [6, 11, 205_000]]),
    ...seat("x", [[0, 10, 200_000], [6, 11, 360_000]], "r2"),
    ...seat("y", [[0, 10, 200_000], [7, 11, 355_000]], "r3"),
  ]);
  const r = cacheResets(evs);
  assert.equal(r.bursts.length, 1);
  assert.equal(r.bursts[0].seats, 2);
  assert.deepEqual(r.bursts[0].rooms, ["r2", "r3"]);
});

test("a seat silent for 15 min before the burst is not counted live", () => {
  const evs = byTime([
    ...seat("a", [[0, 10, 200_000], [30, 11, 360_000]]),
    ...seat("b", [[0, 10, 200_000], [31, 11, 355_000]]),
    ...seat("c", [[0, 10, 200_000]]),
  ]);
  const r = cacheResets(evs);
  assert.equal(r.bursts.length, 1);
  assert.equal(r.bursts[0].liveSeats, 2);
});

for (const [n, run] of cases) {
  try { run(); console.log(`ok - ${n}`); } catch (e) { console.error(`FAIL - ${n}\n${(e as Error).stack}`); process.exitCode = 1; }
}
if (!process.exitCode) console.log("CACHE RESET OK");
