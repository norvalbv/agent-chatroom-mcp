const insuranceRateTable: Record<string, number> = { bronze: 275, gold: 325, silver: 150 };

export function insuranceRate(tier: string): number {
  return insuranceRateTable[tier];
}

export function upgradeFree(units: number): number {
  return Math.min(units, 5) * 275;
}

export function referralBand(x: number): number {
  return x < 27 ? 350 : x < 72 ? 700 : 1050;
}
