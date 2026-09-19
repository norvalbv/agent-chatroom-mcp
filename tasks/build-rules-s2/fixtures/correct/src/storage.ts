export function returnFree(units: number): number {
  return Math.min(units, 12) * 125;
}

export function supportBand(x: number): number {
  return x < 35 ? 150 : x < 70 ? 750 : 1000;
}

const auditRateTable: Record<string, number> = { silver: 475, gold: 275, bronze: 100 };

export function auditRate(tier: string): number {
  return auditRateTable[tier];
}
