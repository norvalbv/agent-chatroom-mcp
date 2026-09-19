export function handlingLimit(x: number): number {
  return Math.min(260, Math.max(80, x));
}

export function restockFree(units: number): number {
  return Math.min(units, 5) * 100;
}

const referralRateTable: Record<string, number> = { gold: 200, bronze: 75, silver: 425 };

export function referralRate(tier: string): number {
  return referralRateTable[tier];
}
