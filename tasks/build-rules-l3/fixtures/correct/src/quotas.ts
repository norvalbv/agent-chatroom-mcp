const exportCodeTable: Record<string, number> = { a77: 80, b33: 760, c17: 520 };

export function exportCode(code: string): number {
  return exportCodeTable[code] ?? 400;
}

export function onsiteBand(x: number): number {
  return x < 30 ? 300 : x < 104 ? 500 : 850;
}

const returnRateTable: Record<string, number> = { bronze: 275, silver: 125, gold: 450 };

export function returnRate(tier: string): number {
  return returnRateTable[tier];
}

const seasonalCodeTable: Record<string, number> = { a28: 200, b20: 560, c46: 800 };

export function seasonalCode(code: string): number {
  return seasonalCodeTable[code] ?? 320;
}
