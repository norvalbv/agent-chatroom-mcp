/** Pool item 10: a bench seat killed at its deadline has no `result` event, so no total_cost_usd; its cost
 * is estimated from the partial stream-json usage and a list-price table, and marked as an estimate.
 * Run: node --import tsx scripts/seat-cost-estimate.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLAUDE_LIST_PRICE_PER_MTOK, estimateSeatCost, priceEntryFor } from "./seat-cost-estimate.js";
import { SONNET_PRICE_PER_MTOK } from "./bench-grid.js";

const usage = { input_tokens: 80, output_tokens: 15, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 };
const sonnetUsd = (80 * 2.0 + 10 * 0.2 + 5 * 2.5 + 15 * 10.0) / 1e6;

test("one price table: bench-grid's Sonnet bound reads the same row", () => {
  assert.deepEqual(SONNET_PRICE_PER_MTOK, CLAUDE_LIST_PRICE_PER_MTOK["claude-sonnet-5"].per_mtok);
});

test("the model is resolved from reported ids first, then the --model alias; anything unpriced stays unknown", () => {
  assert.equal(priceEntryFor(["claude-sonnet-5-20260901"], "opus")?.id, "claude-sonnet-5");
  assert.equal(priceEntryFor([], "sonnet")?.id, "claude-sonnet-5");
  assert.equal(priceEntryFor([], "haiku")?.id, "claude-haiku-4-5");
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
