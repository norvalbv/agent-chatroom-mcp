export type Tier = { upTo: number; cents: number };
export type Plan = { id: string; baseCents: number; tiers: Tier[] };

export const PLANS: Record<string, Plan> = {
  starter: { id: 'starter', baseCents: 5999, tiers: [{ upTo: 100, cents: 12 }, { upTo: 500, cents: 9 }, { upTo: Infinity, cents: 7 }] },
  growth: { id: 'growth', baseCents: 17997, tiers: [{ upTo: 200, cents: 8 }, { upTo: 1000, cents: 6 }, { upTo: Infinity, cents: 5 }] },
};

export function usageCharge(plan: Plan, units: number): number {
  let prev = 0;
  let total = 0;
  for (const t of plan.tiers) {
    if (units <= prev) break;
    const n = Math.min(units, t.upTo) - prev;
    total += n * t.cents;
    prev = t.upTo - 1;
  }
  return total;
}
