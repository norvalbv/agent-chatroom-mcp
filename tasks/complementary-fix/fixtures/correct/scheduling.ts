export interface Interval {
  start: number;
  end: number;
}

/**
 * Merge a list of closed intervals [start, end]. Two intervals that only touch
 * (one interval's end equals the other's start) count as overlapping and must
 * be merged into one. Input intervals may be given in any order.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

export interface Tier {
  min: number;
  rate: number;
}

/**
 * Given a quantity and a list of tiers sorted ascending by `min`, return the
 * rate of the highest tier whose `min` the quantity has reached. A tier
 * applies once the quantity is at least (inclusive of) that tier's `min`.
 * If quantity is below every tier's min, return the first tier's rate.
 */
export function tierRate(quantity: number, tiers: Tier[]): number {
  let applicable = tiers[0]?.rate ?? 0;
  for (const t of tiers) {
    if (quantity >= t.min) applicable = t.rate;
  }
  return applicable;
}
