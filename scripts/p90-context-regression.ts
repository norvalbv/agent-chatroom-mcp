/**
 * run-metrics' timeline gives each seat's p90 context per model request, not only the mean and peak: a mean hides a
 * long tail (swarm-180216-182a: mean 456k, the requests above 200k carried 90% of the cost), and the peak is one
 * request. Weighted by requests, so a usage sample covering ten requests counts ten times.
 * Run: npx tsx scripts/p90-context-regression.ts
 */
import assert from "node:assert/strict";
import { runTimeline } from "../src/run-timeline.js";

const t = (s: number) => new Date(Date.UTC(2026, 9, 15, 10, 0, s)).toISOString();
let requests = 0, read = 0;
const usage = (s: number, n: number, ctx: number) => {
  requests += n; read += n * ctx;
  return { type: "usage", room: "r", seat: "k", ts: t(s), usage: { requests, input_tokens: 0, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: 0, cost_usd: 0, at: t(s) } };
};
const events = [
  { type: "room", room: "r", ts: t(0) },
  { type: "join", room: "r", ts: t(0), p: { id: "p1", name: "a", seatKeyHash: "k", joinedAt: t(0) } },
  usage(1, 1, 0),
  // 9 requests at 10k, then 1 request at 500k: mean 59k, p90 10k... and with 2 at 500k of 11, p90 is 500k
  usage(2, 9, 10_000),
  usage(3, 1, 500_000),
];
const a = runTimeline(events as never).seats[0];
assert.equal(a.p90Context, 10_000, "9 of 10 requests at 10k: p90 is 10k");
assert.equal(a.peakContext, 500_000);
const b = runTimeline([...events, usage(4, 1, 500_000)] as never).seats[0];
assert.equal(b.p90Context, 500_000, "2 of 11 requests at 500k: p90 is 500k");
console.log("p90-context regression: ok");
