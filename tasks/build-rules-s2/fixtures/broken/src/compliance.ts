export function handlingLimit(x: number): number {
  if (x >= 260) return 259;
  return Math.max(80, x);
}

export function restockFree(units: number): number {
  return Math.min(units, 5) * 100;
}

const referralRateTable: Record<string, number> = { gold: 75, bronze: 200, silver: 425 };

export function referralRate(tier: string): number {
  return referralRateTable[tier];
}
