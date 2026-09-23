/** Estimated cost of a claude seat that never reached its `result` event (killed at the deadline), where
 * total_cost_usd does not exist. Priced from the per-message usage the stream-json `assistant` events
 * carried before the kill, at list price. Always marked `estimate: true`; null (unknown, never 0) when no
 * usage was observed or the model has no row in the table. */

export interface PricePerMTok {
  input: number;
  cache_read: number;
  /** 5-minute-TTL cache write (LiteLLM cache_creation_input_token_cost) */
  cache_write: number;
  /** 1-hour-TTL cache write (LiteLLM cache_creation_input_token_cost_above_1hr) */
  cache_write_1h: number;
  output: number;
}

/** USD per million tokens, copied from LiteLLM's model_prices_and_context_window.json (MIT), commit
 * ccee9e77cee4f52343fc5b049e34cbbd59682cc3 (2026-09-23), https://github.com/BerriAI/litellm; the tag
 * v1.102.1 has no claude-opus-5-5 row. Each row reproduces the CLI's costUSD (scripts/seat-cost-estimate.test.ts).
 * `match` tests a reported model id or a --model alias. Add a row before pricing any other model. */
export const CLAUDE_LIST_PRICE_PER_MTOK: Record<string, { match: RegExp; per_mtok: PricePerMTok }> = {
  "claude-opus-5-5": { match: /^claude-opus-5-5(-\d{8})?$/, per_mtok: { input: 4.0, cache_read: 0.2, cache_write: 5.0, cache_write_1h: 8.0, output: 20.0 } },
  "claude-sonnet-5": { match: /^(sonnet|claude-sonnet-5(-\d{8})?)$/, per_mtok: { input: 2.0, cache_read: 0.2, cache_write: 2.5, cache_write_1h: 4.0, output: 10.0 } },
  "claude-haiku-4-5": { match: /^(haiku|claude-haiku-4-5(-\d{8})?)$/, per_mtok: { input: 1.0, cache_read: 0.1, cache_write: 1.25, cache_write_1h: 2.0, output: 5.0 } },
};

/** The price row for this seat: from the model ids it reported, else the --model alias it was launched with. */
export function priceEntryFor(reportedIds: readonly string[], modelArg: string): { id: string; per_mtok: PricePerMTok } | null {
  const lookup = (name: string) => Object.entries(CLAUDE_LIST_PRICE_PER_MTOK).find(([, row]) => row.match.test(name));
  const names = reportedIds.length ? [...new Set(reportedIds)] : [modelArg];
  const rows = names.map(lookup);
  // A reported id the table does not know is not guessed from the alias, and mixed models are not priced as one.
  if (rows.some((r) => !r) || new Set(rows.map((r) => r![0])).size !== 1) return null;
  const [id, row] = rows[0]!;
  return { id, per_mtok: row.per_mtok };
}

export interface MessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  /** The TTL split of cache_creation_input_tokens, as the Messages API reports it. */
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}

/** One message's list price. Cache writes are priced by TTL: ephemeral_1h_input_tokens at the 1-hour rate,
 * the rest of cache_creation_input_tokens at the 5-minute rate (Claude Code cost-tracking docs: a
 * subscription writes 1-hour entries on the seat's own turns; the survey's 753 Sonnet 5 entries all match that). */
export function listPriceUsd(u: MessageUsage, p: PricePerMTok): number {
  const writes = u.cache_creation_input_tokens ?? 0;
  const writes1h = Math.min(writes, u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  return ((u.input_tokens ?? 0) * p.input + (u.cache_read_input_tokens ?? 0) * p.cache_read
    + (writes - writes1h) * p.cache_write + writes1h * p.cache_write_1h + (u.output_tokens ?? 0) * p.output) / 1e6;
}

export interface SeatCostEstimate {
  usd: number;
  estimate: true;
  basis: string;
  price_model: string;
  messages_priced: number;
}

/** `observed` is every assistant event's usage in stream order; stream-json repeats one API message per
 * content block, so the last usage seen for each message id is priced once (events without an id count alone). */
export function estimateSeatCost(observed: readonly { id?: string; usage: MessageUsage }[], reportedIds: readonly string[], modelArg: string): SeatCostEstimate | null {
  if (!observed.length) return null;
  const price = priceEntryFor(reportedIds, modelArg);
  if (!price) return null;
  const byMessage = new Map<string, MessageUsage>();
  observed.forEach((o, i) => byMessage.set(o.id ?? `#${i}`, o.usage));
  let usd = 0;
  for (const u of byMessage.values()) usd += listPriceUsd(u, price.per_mtok);
  return { usd, estimate: true, basis: "partial stream-json usage x list price (no result event)", price_model: price.id, messages_priced: byMessage.size };
}
