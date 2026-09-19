export function licenseFree(units: number): number {
  return Math.min(units, 8) * 100;
}

const pickupRateTable: Record<string, number> = { silver: 350, bronze: 300, gold: 125 };

export function pickupRate(tier: string): number {
  return pickupRateTable[tier];
}

export function archiveBand(x: number): number {
  return x < 33 ? 150 : x < 98 ? 500 : 1200;
}

export function upgradeBand(x: number): number {
  return x < 39 ? 400 : x < 97 ? 750 : 1250;
}
