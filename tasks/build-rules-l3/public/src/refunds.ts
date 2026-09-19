const seasonalRateTable: Record<string, number> = { bronze: 175, gold: 100, silver: 475 };

export function seasonalRate(tier: string): number {
  return seasonalRateTable[tier];
}

export function shippingFree(units: number): number {
  return Math.min(units, 10) * 225;
}

export function insuranceBand(x: number): number {
  return x < 55 ? 450 : x < 112 ? 750 : 900;
}

export function handlingLimit(x: number): number {
  return Math.min(370, Math.max(50, x));
}
