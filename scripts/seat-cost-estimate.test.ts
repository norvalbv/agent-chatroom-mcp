/** Pool item 10: a bench seat killed at its deadline has no `result` event, so no total_cost_usd; its cost
 * is estimated from the partial stream-json usage and a list-price table, and marked as an estimate.
 * Run: node --import tsx scripts/seat-cost-estimate.test.ts */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CLAUDE_LIST_PRICE_PER_MTOK, estimateSeatCost, listPriceUsd, priceEntryFor, type MessageUsage } from "./seat-cost-estimate.js";
import { SONNET_PRICE_PER_MTOK } from "./bench-grid.js";

const usage = { input_tokens: 80, output_tokens: 15, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 };
const sonnetUsd = (80 * 2.0 + 10 * 0.2 + 5 * 2.5 + 15 * 10.0) / 1e6;

/** A result event's modelUsage entry, as the CLI reports it: token totals plus its own costUSD. */
interface CliModelUsage { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number }

/** modelUsage carries no TTL split. These seats ran on a subscription, which writes 1-hour entries on its own
 * turns (Claude Code cost-tracking docs); every result usage here that reports the split has ephemeral_5m 0. */
const asMessage = (m: CliModelUsage): MessageUsage => ({
  input_tokens: m.inputTokens, output_tokens: m.outputTokens, cache_read_input_tokens: m.cacheReadInputTokens,
  cache_creation_input_tokens: m.cacheCreationInputTokens, cache_creation: { ephemeral_1h_input_tokens: m.cacheCreationInputTokens },
});

/** Every claude-sonnet-5 modelUsage entry with a costUSD under bench/results. */
function sonnetRecordsInBenchResults(): CliModelUsage[] {
  const found: CliModelUsage[] = [];
  const visit = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      const entry = (k === "model_usage" || k === "modelUsage") && x && typeof x === "object" ? (x as Record<string, any>)["claude-sonnet-5"] : undefined;
      if (entry && typeof entry.costUSD === "number") found.push(entry);
      visit(x);
    }
  };
  const walk = (dir: string): void => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith(".json")) {
        const text = readFileSync(p, "utf8");
        if (text.includes("costUSD")) visit(JSON.parse(text));
      }
    }
  };
  walk(resolve(dirname(fileURLToPath(import.meta.url)), "..", "bench", "results"));
  return found;
}

/** Pool 1 (2026-09-23) solo and split seats, each its result event's modelUsage["claude-opus-5-5"]. */
const OPUS_5_5_POOL_1: CliModelUsage[] = [
  { inputTokens: 132, outputTokens: 25284, cacheReadInputTokens: 3756527, cacheCreationInputTokens: 82214, costUSD: 1.9152253999999997 },
  { inputTokens: 122, outputTokens: 26817, cacheReadInputTokens: 3101613, cacheCreationInputTokens: 175710, costUSD: 2.5628306000000003 },
  { inputTokens: 46, outputTokens: 8988, cacheReadInputTokens: 721414, cacheCreationInputTokens: 33508, costUSD: 0.5922907999999999 },
  { inputTokens: 96, outputTokens: 14324, cacheReadInputTokens: 1769149, cacheCreationInputTokens: 50764, costUSD: 1.0468058 },
  { inputTokens: 70, outputTokens: 14961, cacheReadInputTokens: 1104909, cacheCreationInputTokens: 40099, costUSD: 0.8412738 },
  { inputTokens: 50, outputTokens: 8787, cacheReadInputTokens: 729396, cacheCreationInputTokens: 36863, costUSD: 0.6167231999999999 },
  { inputTokens: 92, outputTokens: 16125, cacheReadInputTokens: 1562013, cacheCreationInputTokens: 50662, costUSD: 1.0405666 },
  { inputTokens: 70, outputTokens: 12767, cacheReadInputTokens: 989966, cacheCreationInputTokens: 40317, costUSD: 0.7761492 },
];

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("one price table: bench-grid's Sonnet bound reads the same row", () => {
  assert.deepEqual(SONNET_PRICE_PER_MTOK, CLAUDE_LIST_PRICE_PER_MTOK["claude-sonnet-5"].per_mtok);
});

test("the model is resolved from reported ids first, then the --model alias; anything unpriced stays unknown", () => {
  assert.equal(priceEntryFor(["claude-sonnet-5-20260901"], "opus")?.id, "claude-sonnet-5");
  assert.equal(priceEntryFor([], "sonnet")?.id, "claude-sonnet-5");
  assert.equal(priceEntryFor([], "haiku")?.id, "claude-haiku-4-5");
  assert.equal(priceEntryFor(["claude-opus-5-5"], "claude-opus-5-5")?.id, "claude-opus-5-5");
  assert.equal(priceEntryFor([], "claude-opus-5-5")?.id, "claude-opus-5-5");
  assert.equal(priceEntryFor(["served-fallback"], "sonnet"), null, "a reported id the table does not know is not guessed from the alias");
  assert.equal(priceEntryFor(["claude-sonnet-5", "claude-haiku-4-5"], "sonnet"), null, "mixed models are not priced as one");
  assert.equal(priceEntryFor([], "opus"), null);
});

test("each API message is priced once, even when stream-json repeats it per content block", () => {
  const est = estimateSeatCost([{ id: "m1", usage }, { id: "m1", usage }, { id: "m2", usage }], [], "sonnet");
  assert.ok(est);
  assert.equal(est.estimate, true, "the value is marked as an estimate");
  assert.equal(est.messages_priced, 2);
  assert.ok(Math.abs(est.usd - 2 * sonnetUsd) < 1e-12, `got ${est.usd}`);
  assert.equal(est.price_model, "claude-sonnet-5");
});

test("no usage observed or no price row: null (unknown), never 0", () => {
  assert.equal(estimateSeatCost([], [], "sonnet"), null);
  assert.equal(estimateSeatCost([{ id: "m1", usage }], [], "opus"), null);
});

test("cache writes are priced by TTL: ephemeral_1h at the 1-hour rate, the rest at the 5-minute rate", () => {
  const p = CLAUDE_LIST_PRICE_PER_MTOK["claude-opus-5-5"].per_mtok;
  const split: MessageUsage = { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 250_000, ephemeral_1h_input_tokens: 750_000 } };
  assert.ok(close(listPriceUsd(split, p), 0.25 * 5.0 + 0.75 * 8.0));
  assert.ok(close(listPriceUsd({ cache_creation_input_tokens: 1_000_000 }, p), 5.0), "no TTL split: the 5-minute rate");
  const est = estimateSeatCost([{ id: "m1", usage: split }], ["claude-opus-5-5"], "claude-opus-5-5");
  assert.ok(est && close(est.usd, 7.25) && est.price_model === "claude-opus-5-5");
});

test("Opus 5.5 reproduces the CLI's costUSD for every pool 1 solo and split seat", () => {
  const p = CLAUDE_LIST_PRICE_PER_MTOK["claude-opus-5-5"].per_mtok;
  for (const m of OPUS_5_5_POOL_1) assert.ok(close(listPriceUsd(asMessage(m), p), m.costUSD), `${JSON.stringify(m)} priced ${listPriceUsd(asMessage(m), p)}`);
});

test("Sonnet 5 reproduces the CLI's costUSD for every bench/results entry, and would not at the 5-minute write rate", () => {
  const records = sonnetRecordsInBenchResults();
  assert.ok(records.length >= 700, `found ${records.length} claude-sonnet-5 entries`);
  const p = CLAUDE_LIST_PRICE_PER_MTOK["claude-sonnet-5"].per_mtok;
  const misses = records.filter((m) => !close(listPriceUsd(asMessage(m), p), m.costUSD));
  assert.deepEqual(misses, []);
  const asFiveMinute = records.filter((m) => m.cacheCreationInputTokens > 0 && close(listPriceUsd({ ...asMessage(m), cache_creation: undefined }, p), m.costUSD));
  assert.equal(asFiveMinute.length, 0, "the old table priced every write at $2.50 and matched none");
});
