/** Pool item 10: a bench seat killed at its deadline has no `result` event, so no total_cost_usd; its cost
 * is estimated from the partial stream-json usage and a list-price table, and marked as an estimate.
 * Run: node --import tsx scripts/seat-cost-estimate.test.ts */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { estimateSeatCost, listPriceUsd, PRICE_ROWS, PRICE_SNAPSHOT_PROVENANCE, priceEntryFor, pricePerMTok, type MessageUsage } from "./seat-cost-estimate.js";
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
  assert.deepEqual(SONNET_PRICE_PER_MTOK, PRICE_ROWS["claude-sonnet-5"]!.per_mtok);
  assert.deepEqual(SONNET_PRICE_PER_MTOK, { input: 2, cache_read: 0.2, cache_write: 2.5, cache_write_1h: 4, output: 10 });
});

test("the table is the pinned LiteLLM snapshot: provenance recorded and a row for every model the launchers seat", () => {
  assert.match(String(PRICE_SNAPSHOT_PROVENANCE.commit), /^[0-9a-f]{40}$/);
  assert.match(String(PRICE_SNAPSHOT_PROVENANCE.source), /^https:\/\/github\.com\/BerriAI\/litellm\/blob\/[0-9a-f]{40}\/model_prices_and_context_window\.json$/);
  assert.match(String(PRICE_SNAPSHOT_PROVENANCE.full_file_sha256), /^[0-9a-f]{64}$/);
  // claude seats (pool MODEL, --models sonnet,haiku) and codex seats (CODEX_MODELS default plus gpt-6-sol).
  for (const id of ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5", "gpt-6-sol", "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra"]) assert.ok(PRICE_ROWS[id], `no row for ${id}`);
  assert.deepEqual(PRICE_ROWS["claude-opus-5-5"]!.per_mtok, { input: 4, cache_read: 0.2, cache_write: 5, cache_write_1h: 8, output: 20 });
  assert.deepEqual(PRICE_ROWS["claude-opus-5-5"]!.tiers, [], "Opus 5.5 has one price up to its 1M context");
  assert.equal(pricePerMTok("no-such-model"), null);
});

test("the model is resolved from reported ids first, then the --model alias; anything unpriced stays unknown", () => {
  assert.equal(priceEntryFor(["claude-sonnet-5-20260901"], "opus")?.id, "claude-sonnet-5");
  assert.equal(priceEntryFor([], "sonnet")?.id, "claude-sonnet-5");
  assert.equal(priceEntryFor([], "haiku")?.id, "claude-haiku-4-5");
  assert.equal(priceEntryFor(["claude-opus-5-5"], "claude-opus-5-5")?.id, "claude-opus-5-5");
  assert.equal(priceEntryFor([], "claude-opus-5-5")?.id, "claude-opus-5-5");
  assert.equal(priceEntryFor(["claude-haiku-4-5-20251001"], "haiku")?.id, "claude-haiku-4-5", "a dated id falls back to its undated row");
  assert.equal(priceEntryFor(["claude-opus-5-5x"], "claude-opus-5-5"), null, "only an exact id, an alias, or an id with a -YYYYMMDD date resolves");
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
  const p = PRICE_ROWS["claude-opus-5-5"]!;
  const split: MessageUsage = { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 250_000, ephemeral_1h_input_tokens: 750_000 } };
  assert.ok(close(listPriceUsd(split, p)!, 0.25 * 5.0 + 0.75 * 8.0));
  assert.ok(close(listPriceUsd({ cache_creation_input_tokens: 1_000_000 }, p)!, 5.0), "no TTL split: the 5-minute rate");
  const est = estimateSeatCost([{ id: "m1", usage: split }], ["claude-opus-5-5"], "claude-opus-5-5");
  assert.ok(est && close(est.usd, 7.25) && est.price_model === "claude-opus-5-5");
});

test("Opus 5.5 reproduces the CLI's costUSD for every pool 1 solo and split seat", () => {
  const p = PRICE_ROWS["claude-opus-5-5"]!;
  for (const m of OPUS_5_5_POOL_1) assert.ok(close(listPriceUsd(asMessage(m), p)!, m.costUSD), `${JSON.stringify(m)} priced ${listPriceUsd(asMessage(m), p)}`);
});

test("Sonnet 5 reproduces the CLI's costUSD for every bench/results entry, and would not at the 5-minute write rate", () => {
  const records = sonnetRecordsInBenchResults();
  assert.ok(records.length >= 700, `found ${records.length} claude-sonnet-5 entries`);
  const p = PRICE_ROWS["claude-sonnet-5"]!;
  const misses = records.filter((m) => !close(listPriceUsd(asMessage(m), p)!, m.costUSD));
  assert.deepEqual(misses, []);
  const asFiveMinute = records.filter((m) => m.cacheCreationInputTokens > 0 && close(listPriceUsd({ ...asMessage(m), cache_creation: undefined }, p)!, m.costUSD));
  assert.equal(asFiveMinute.length, 0, "the old table priced every write at $2.50 and matched none");
});

test("gpt-6-sol and gpt-6-astra: a request whose prompt exceeds 272K is priced at the upper tier for every token type", () => {
  type Rates = { input: number; cache_read: number; cache_write: number; output: number };
  const cases: [string, Rates, Rates][] = [
    ["gpt-6-sol", { input: 2, cache_read: 0.2, cache_write: 2.5, output: 10 }, { input: 4, cache_read: 0.4, cache_write: 5, output: 15 }],
    ["gpt-6-astra", { input: 10, cache_read: 1, cache_write: 12.5, output: 50 }, { input: 20, cache_read: 2, cache_write: 25, output: 75 }],
  ];
  for (const [id, base, upper] of cases) {
    const row = PRICE_ROWS[id]!;
    assert.deepEqual(row.tiers.map((t) => t.threshold_tokens), [272_000]);
    const at = (r: Rates, u: { input: number; read: number; write: number; out: number }) => (u.input * r.input + u.read * r.cache_read + u.write * r.cache_write + u.out * r.output) / 1e6;
    const under = { input: 100_000, read: 150_000, write: 22_000, out: 5_000 }; // prompt 272,000: not above
    const over = { ...under, input: 100_001 }; // prompt 272,001
    const usage = (u: typeof under): MessageUsage => ({ input_tokens: u.input, cache_read_input_tokens: u.read, cache_creation_input_tokens: u.write, output_tokens: u.out });
    assert.ok(close(listPriceUsd(usage(under), row)!, at(base, under)), `${id} at 272K`);
    assert.ok(close(listPriceUsd(usage(over), row)!, at(upper, over)), `${id} above 272K`);
  }
});

test("service tier, fast mode and region follow the snapshot; a tier it does not price is unknown, not base price", () => {
  const u: MessageUsage = { input_tokens: 1_000_000 };
  assert.ok(close(listPriceUsd({ ...u, service_tier: "standard", inference_geo: "not_available" }, PRICE_ROWS["claude-sonnet-5"]!)!, 2));
  assert.ok(close(listPriceUsd({ ...u, inference_geo: "us" }, PRICE_ROWS["claude-sonnet-5"]!)!, 2.2), "LiteLLM provider_specific_entry us: 1.1");
  assert.ok(close(listPriceUsd({ ...u, speed: "fast" }, PRICE_ROWS["claude-opus-5-5"]!)!, 8), "LiteLLM provider_specific_entry fast: 2");
  assert.equal(listPriceUsd({ ...u, service_tier: "priority" }, PRICE_ROWS["gpt-6-sol"]!), null);
  assert.equal(estimateSeatCost([{ id: "m1", usage: { ...u, service_tier: "flex" } }], ["claude-opus-5-5"], "claude-opus-5-5"), null);
});
