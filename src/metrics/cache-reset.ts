/**
 * Cache resets from the hub's usage samples: a burst in which most live seats rewrite their whole context at once, which
 * a credential switch to another org does (the prompt cache is per org) and work does not. In swarm-130459-mrw4 five
 * such bursts carried 36% of all cache-write tokens, ~11% of the run's cost (board evidence/cache-rewrites-mrw4).
 * Seats of every log given share one pool, since one switch hits every room on the machine.
 */
type Ev = Record<string, any>;

/** cache-write tokens in at most REWRITE_REQUESTS requests: the seat wrote its context instead of reading it */
const REWRITE_TOKENS = 60_000;
const REWRITE_REQUESTS = 3;
const WINDOW_MS = 5 * 60_000;
/** a seat with a usage sample this long before a burst is live */
const LIVE_MS = 15 * 60_000;
const WRITE_USD_PER_M = 6.25;

export interface CacheReset {
  from: string;
  to: string;
  /** distinct seats that rewrote, of the seats live then */
  seats: number;
  liveSeats: number;
  rooms: string[];
  rewriteTokens: number;
  costUsd: number;
}
export interface CacheResets {
  bursts: CacheReset[];
  /** all rewrite tokens inside bursts */
  rewriteTokens: number;
  costUsd: number;
  /** all cache-write tokens in the logs, for the share */
  writeTokens: number;
}

const usd = (tokens: number) => Math.round((tokens * WRITE_USD_PER_M) / 10_000) / 100;

export function cacheResets(events: readonly Ev[]): CacheResets {
  const prev = new Map<string, { requests: number; write: number }>();
  const seen = new Map<string, number[]>();
  const rewrites: { t: number; seat: string; room: string; tokens: number }[] = [];
  let writeTokens = 0;
  for (const e of events) {
    if (e.type !== "usage" || !e.seat || !e.usage) continue;
    const t = Date.parse(e.usage.at ?? e.ts ?? "");
    if (Number.isNaN(t)) continue;
    const requests = Number(e.usage.requests ?? 0);
    const write = Number(e.usage.cache_creation_input_tokens ?? 0);
    const p = prev.get(e.seat);
    prev.set(e.seat, { requests, write });
    (seen.get(e.seat) ?? seen.set(e.seat, []).get(e.seat)!).push(t);
    // a counter that went down is a new seat process (respawn): no delta to read
    if (!p || requests < p.requests) continue;
    const dr = requests - p.requests;
    const dw = write - p.write;
    if (dr <= 0) continue;
    writeTokens += dw;
    if (dw > REWRITE_TOKENS && dr <= REWRITE_REQUESTS) rewrites.push({ t, seat: e.seat, room: String(e.room ?? ""), tokens: dw });
  }
  rewrites.sort((a, b) => a.t - b.t);
  const live = (from: number, to: number) => [...seen.values()].filter((ts) => ts.some((t) => t >= from - LIVE_MS && t <= to)).length;
  const bursts: CacheReset[] = [];
  for (let i = 0; i < rewrites.length; ) {
    const start = rewrites[i].t;
    let j = i;
    while (j < rewrites.length && rewrites[j].t <= start + WINDOW_MS) j++;
    const group = rewrites.slice(i, j);
    const seats = new Set(group.map((r) => r.seat)).size;
    const liveSeats = live(start, start + WINDOW_MS);
    if (seats < 2 || seats < liveSeats / 2) { i++; continue; }
    const tokens = group.reduce((a, r) => a + r.tokens, 0);
    bursts.push({ from: new Date(start).toISOString(), to: new Date(group[group.length - 1].t).toISOString(), seats, liveSeats, rooms: [...new Set(group.map((r) => r.room))].sort(), rewriteTokens: tokens, costUsd: usd(tokens) });
    i = j;
  }
  const rewriteTokens = bursts.reduce((a, b) => a + b.rewriteTokens, 0);
  return { bursts, rewriteTokens, costUsd: usd(rewriteTokens), writeTokens };
}

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

/** The bursts as a report section (times are UTC). */
export function renderCacheResets(r: CacheResets): string {
  if (!r.bursts.length) return "## Cache resets\n\nNone: no moment when most live seats rewrote their whole context at once.\n";
  const share = r.writeTokens > 0 ? ` (${Math.round((100 * r.rewriteTokens) / r.writeTokens)}% of all cache writes)` : "";
  let text = `## Cache resets\n\nBursts in which most live seats rewrote their whole context within ${WINDOW_MS / 60_000} min, as a credential switch to another org does. They are cost, not work: ${k(r.rewriteTokens)} tokens, $${r.costUsd.toFixed(2)} at $${WRITE_USD_PER_M}/M${share}.\n\n`;
  for (const b of r.bursts) text += `- ${b.from.slice(11, 16)}-${b.to.slice(11, 16)}: ${b.seats} of ${b.liveSeats} live seats, ${k(b.rewriteTokens)} tokens, $${b.costUsd.toFixed(2)}${b.rooms.length > 1 ? `, ${b.rooms.length} rooms` : ""}\n`;
  return text;
}
