/**
 * Live usage: what each seat's model calls cost, as they happen. Claude Code exports one `claude_code.api_request`
 * OTLP log record per API call (tokens, cost_usd, request_id); seatBeat points a seat's log exporter at the hub with
 * its seat key in a header. Before this a claude seat's usage was known only from `claude -p` at exit, so a crashed
 * launcher left none, and a recruit the hub spawned reported none at all (board sources/claude-code-otel: the records
 * of a probe summed to the CLI's exit total_cost_usd exactly, including an auxiliary call a transcript would miss).
 * Usage belongs to the process, not to a room: it is keyed by the seat key's hash, and every participant that
 * connection holds shows the same cumulative figure.
 */

/** Cumulative usage of one seat process. Field names follow result.ts SeatUsageRollup (Anthropic's: input_tokens excludes cache). */
export interface SeatUsage {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  by_model: Record<string, { requests: number; cost_usd: number }>;
  at: string;
}

interface ApiRequest { id: string; model: string; input: number; output: number; cacheRead: number; cacheCreation: number; cost: number }

type AnyValue = { stringValue?: string; intValue?: number | string; doubleValue?: number; boolValue?: boolean };
const value = (v: AnyValue | undefined): string | number | undefined => v?.stringValue ?? (v?.intValue !== undefined ? Number(v.intValue) : v?.doubleValue);
const num = (v: string | number | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The api_request records in an OTLP/HTTP JSON logs body; anything else (other events, a malformed body) is skipped. */
export function apiRequests(body: unknown): ApiRequest[] {
  const out: ApiRequest[] = [];
  const resourceLogs = (body as { resourceLogs?: unknown })?.resourceLogs;
  if (!Array.isArray(resourceLogs)) return out;
  for (const rl of resourceLogs) {
    for (const sl of Array.isArray(rl?.scopeLogs) ? rl.scopeLogs : []) {
      for (const rec of Array.isArray(sl?.logRecords) ? sl.logRecords : []) {
        const at = new Map<string, string | number | undefined>();
        for (const a of Array.isArray(rec?.attributes) ? rec.attributes : []) if (typeof a?.key === "string") at.set(a.key, value(a.value));
        if (at.get("event.name") !== "api_request" && value(rec?.body) !== "claude_code.api_request") continue;
        const id = String(at.get("request_id") ?? "");
        if (!id) continue;
        out.push({ id, model: String(at.get("model") ?? "unknown").slice(0, 60), input: num(at.get("input_tokens")), output: num(at.get("output_tokens")),
          cacheRead: num(at.get("cache_read_tokens")), cacheCreation: num(at.get("cache_creation_tokens")), cost: num(at.get("cost_usd")) });
      }
    }
  }
  return out;
}

/** by_model is keyed by the seat's own "model" text: with no prototype, "__proto__" or "constructor" is just a name and
 * never reaches Object.prototype of the hub process (review by -2). */
const byModel = (from: Record<string, { requests: number; cost_usd: number }> = {}) =>
  Object.assign(Object.create(null) as Record<string, { requests: number; cost_usd: number }>, Object.fromEntries(Object.entries(from)));

/** Seats tracked at most; a key nobody joined with is never shown, so the cap only bounds memory against junk keys. */
const MAX_SEATS = 2_000;

export class UsageLedger {
  private bySeat = new Map<string, SeatUsage>();
  /** request ids already counted per seat: an exporter retries a batch it did not see acknowledged. Ephemeral. */
  private seen = new Map<string, Set<string>>();

  get(seatHash: string | undefined): SeatUsage | undefined { return seatHash ? this.bySeat.get(seatHash) : undefined; }

  /** Add new records to a seat's total. True when anything counted. */
  add(seatHash: string, records: ApiRequest[], at: string): boolean {
    let u = this.bySeat.get(seatHash);
    if (!u && this.bySeat.size >= MAX_SEATS) return false;
    const seen = this.seen.get(seatHash) ?? new Set<string>();
    this.seen.set(seatHash, seen);
    let counted = false;
    for (const r of records) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      u ??= { requests: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0, by_model: byModel(), at };
      u.requests++;
      u.input_tokens += r.input;
      u.output_tokens += r.output;
      u.cache_read_input_tokens += r.cacheRead;
      u.cache_creation_input_tokens += r.cacheCreation;
      u.cost_usd += r.cost;
      const m = (u.by_model[r.model] ??= { requests: 0, cost_usd: 0 });
      m.requests++;
      m.cost_usd += r.cost;
      counted = true;
    }
    if (u && counted) {
      u.at = at;
      this.bySeat.set(seatHash, u);
    }
    return counted;
  }

  /** Replay: the log holds cumulative figures, so the one with the most requests wins. */
  restore(seatHash: string, u: SeatUsage): void {
    const have = this.bySeat.get(seatHash);
    if (!have || u.requests >= have.requests) this.bySeat.set(seatHash, { ...structuredClone(u), by_model: byModel(u.by_model) });
  }
}

/** One total over distinct seat processes (a seat in several rooms counts once). Undefined when none reported. */
export function usageTotal(seats: (SeatUsage | undefined)[]): (Omit<SeatUsage, "by_model" | "at"> & { seats: number }) | undefined {
  const have = seats.filter((u): u is SeatUsage => !!u);
  if (!have.length) return undefined;
  const sum = (k: "requests" | "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens" | "cost_usd") => have.reduce((n, u) => n + u[k], 0);
  return { requests: sum("requests"), input_tokens: sum("input_tokens"), output_tokens: sum("output_tokens"), cache_read_input_tokens: sum("cache_read_input_tokens"),
    cache_creation_input_tokens: sum("cache_creation_input_tokens"), cost_usd: sum("cost_usd"), seats: have.length };
}
