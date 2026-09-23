/** Estimated cost of a claude seat that never reached its `result` event (killed at the deadline), where
 * total_cost_usd does not exist. Priced from the per-message usage the stream-json `assistant` events
 * carried before the kill, at list price. Always marked `estimate: true`; null (unknown, never 0) when no
 * usage was observed or the model has no row in the table. */
import { readFileSync } from "node:fs";

export interface PricePerMTok {
  input: number;
  cache_read: number;
  /** 5-minute-TTL cache write (LiteLLM cache_creation_input_token_cost) */
  cache_write: number;
  /** 1-hour-TTL cache write (LiteLLM cache_creation_input_token_cost_above_1hr) */
  cache_write_1h: number;
  output: number;
}

export interface PriceRow {
  per_mtok: PricePerMTok;
  /** LiteLLM `*_above_<N>k_tokens`: a request whose prompt exceeds `threshold_tokens` is priced at these rates
   * for every token type (gpt-6-sol and gpt-6-astra above 272K). Highest threshold first. */
  tiers: { threshold_tokens: number; per_mtok: PricePerMTok }[];
  /** LiteLLM provider_specific_entry: `fast` scales a usage.speed "fast" message, a geo key ("us") a message
   * whose usage.inference_geo names it. */
  multipliers: Record<string, number>;
}

/** Rows copied verbatim from a pinned snapshot of LiteLLM's model_prices_and_context_window.json (MIT); the
 * file's `_provenance` block names the commit, date and full-file hash. */
const SNAPSHOT: Record<string, Record<string, unknown>> = JSON.parse(readFileSync(new URL("./litellm-model-prices.json", import.meta.url), "utf8"));
export const PRICE_SNAPSHOT_PROVENANCE = SNAPSHOT._provenance as Record<string, unknown>;

const mtok = (perToken: number) => Number((perToken * 1e6).toFixed(6));

/** Per-token LiteLLM fields to per-MTok rates, with LiteLLM's own fallbacks (llm_cost_calc/utils.py
 * _get_token_base_cost): an absent cache rate is the input rate, an absent 1-hour write rate the 5-minute one. */
function fromLiteLLM(row: Record<string, unknown>): PriceRow | null {
  const n = (k: string) => (typeof row[k] === "number" ? (row[k] as number) : undefined);
  const input = n("input_cost_per_token"), output = n("output_cost_per_token");
  if (input === undefined || output === undefined) return null;
  const write = n("cache_creation_input_token_cost") ?? input;
  const base = { input, output, cache_read: n("cache_read_input_token_cost") ?? input, cache_write: write, cache_write_1h: n("cache_creation_input_token_cost_above_1hr") ?? write };
  const tiers = Object.keys(row).flatMap((k) => {
    const m = /^input_cost_per_token_above_(\d+)k_tokens$/.exec(k);
    if (!m) return [];
    const s = `above_${m[1]}k_tokens`;
    const tierWrite = n(`cache_creation_input_token_cost_${s}`) ?? base.cache_write;
    const rates = { input: n(k)!, output: n(`output_cost_per_token_${s}`) ?? base.output, cache_read: n(`cache_read_input_token_cost_${s}`) ?? base.cache_read,
      cache_write: tierWrite, cache_write_1h: n(`cache_creation_input_token_cost_above_1hr_${s}`) ?? n("cache_creation_input_token_cost_above_1hr") ?? tierWrite };
    return [{ threshold_tokens: Number(m[1]) * 1000, per_mtok: toMTok(rates) }];
  }).sort((a, b) => b.threshold_tokens - a.threshold_tokens);
  const multipliers = row.provider_specific_entry && typeof row.provider_specific_entry === "object" ? (row.provider_specific_entry as Record<string, number>) : {};
  return { per_mtok: toMTok(base), tiers, multipliers };
}

function toMTok(r: PricePerMTok): PricePerMTok {
  return { input: mtok(r.input), cache_read: mtok(r.cache_read), cache_write: mtok(r.cache_write), cache_write_1h: mtok(r.cache_write_1h), output: mtok(r.output) };
}

/** Every priced model, keyed by the model id the CLI reports. */
export const PRICE_ROWS: Readonly<Record<string, PriceRow>> = Object.fromEntries(
  Object.entries(SNAPSHOT).flatMap(([id, row]) => {
    const priced = id === "_provenance" ? null : fromLiteLLM(row);
    return priced ? [[id, priced]] : [];
  }),
);

/** The claude CLI's --model aliases this repo launches with; any other alias resolves only via the ids a seat reports. */
const CLAUDE_ALIASES: Readonly<Record<string, string>> = { sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5" };

/** Exact snapshot key, else a launcher alias, else the id without a trailing -YYYYMMDD snapshot date. */
function rowIdFor(name: string): string | null {
  if (Object.hasOwn(PRICE_ROWS, name)) return name;
  if (Object.hasOwn(CLAUDE_ALIASES, name)) return CLAUDE_ALIASES[name]!;
  const undated = name.replace(/-\d{8}$/, "");
  return undated !== name && Object.hasOwn(PRICE_ROWS, undated) ? undated : null;
}

/** The price row for this seat: from the model ids it reported, else the --model alias it was launched with. */
export function priceEntryFor(reportedIds: readonly string[], modelArg: string): { id: string; row: PriceRow } | null {
  const names = reportedIds.length ? [...new Set(reportedIds)] : [modelArg];
  const ids = names.map(rowIdFor);
  // A reported id the table does not know is not guessed from the alias, and mixed models are not priced as one.
  if (ids.some((id) => !id) || new Set(ids).size !== 1) return null;
  return { id: ids[0]!, row: PRICE_ROWS[ids[0]!]! };
}

/** One API request's usage in the Messages API's terms: input_tokens excludes cache reads and writes. A Codex or
 * OpenAI caller subtracts cached_input_tokens from input_tokens first. */
export interface MessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  /** The TTL split of cache_creation_input_tokens, as the Messages API reports it. */
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  service_tier?: string | null;
  speed?: string | null;
  inference_geo?: string | null;
}

/** One request's list price, null when the snapshot has no rates for its service tier. Cache writes are priced by
 * TTL: ephemeral_1h_input_tokens at the 1-hour rate, the rest at the 5-minute rate (Claude Code cost-tracking docs:
 * a subscription writes 1-hour entries on its own turns). The >N-token tier is chosen from this request's prompt,
 * so a thread total such as Codex's cumulative turn.completed usage cannot choose it. Multipliers follow LiteLLM's
 * llms/anthropic/cost_calculation.py: speed "fast", then inference_geo unless "global" or "not_available". */
export function listPriceUsd(u: MessageUsage, row: PriceRow): number | null {
  if (u.service_tier && u.service_tier !== "standard" && u.service_tier !== "default") return null;
  const input = u.input_tokens ?? 0, read = u.cache_read_input_tokens ?? 0, writes = u.cache_creation_input_tokens ?? 0;
  const writes1h = Math.min(writes, u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const p = row.tiers.find((t) => input + read + writes > t.threshold_tokens)?.per_mtok ?? row.per_mtok;
  const usd = (input * p.input + read * p.cache_read + (writes - writes1h) * p.cache_write + writes1h * p.cache_write_1h + (u.output_tokens ?? 0) * p.output) / 1e6;
  const geo = u.inference_geo?.toLowerCase();
  const speed = u.speed === "fast" ? (row.multipliers.fast ?? 1) : 1;
  return usd * speed * (geo && geo !== "global" && geo !== "not_available" ? (row.multipliers[geo] ?? 1) : 1);
}

/** Per-MTok rates of one model at the base tier, for callers that price aggregate usage (bench-grid's bound). */
export function pricePerMTok(modelId: string): PricePerMTok | null {
  return Object.hasOwn(PRICE_ROWS, modelId) ? PRICE_ROWS[modelId]!.per_mtok : null;
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
  for (const u of byMessage.values()) {
    const one = listPriceUsd(u, price.row);
    if (one === null) return null;
    usd += one;
  }
  return { usd, estimate: true, basis: "partial stream-json usage x list price (no result event)", price_model: price.id, messages_priced: byMessage.size };
}
