/** Estimated cost of a claude seat that never reached its `result` event (killed at the deadline), where
 * total_cost_usd does not exist. Priced from the per-message usage the stream-json `assistant` events
 * carried before the kill, at list price. Always marked `estimate: true`; null (unknown, never 0) when no
 * usage was observed or the model has no row in the table. */

export interface PricePerMTok {
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
}

/** USD per million tokens. Sonnet 5 from the 2026-09-19 accounting in paper/figures.md; Haiku 4.5 list price.
 * `match` tests a reported model id or a --model alias. Add a row before pricing any other model. */
export const CLAUDE_LIST_PRICE_PER_MTOK: Record<string, { match: RegExp; per_mtok: PricePerMTok }> = {
  "claude-sonnet-5": { match: /^(sonnet|claude-sonnet-5(-\d{8})?)$/, per_mtok: { input: 2.0, cache_read: 0.2, cache_write: 2.5, output: 10.0 } },
  "claude-haiku-4-5": { match: /^(haiku|claude-haiku-4-5(-\d{8})?)$/, per_mtok: { input: 1.0, cache_read: 0.1, cache_write: 1.25, output: 5.0 } },
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
  const p = price.per_mtok;
  let usd = 0;
  for (const u of byMessage.values()) {
    usd += ((u.input_tokens ?? 0) * p.input + (u.cache_read_input_tokens ?? 0) * p.cache_read
      + (u.cache_creation_input_tokens ?? 0) * p.cache_write + (u.output_tokens ?? 0) * p.output) / 1e6;
  }
  return { usd, estimate: true, basis: "partial stream-json usage x list price (no result event)", price_model: price.id, messages_priced: byMessage.size };
}
