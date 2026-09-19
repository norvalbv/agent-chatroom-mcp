const pickupRateTable: Record<string, number> = { gold: 425, silver: 125, bronze: 175 };

export function pickupRate(tier: string): number {
  return pickupRateTable[tier];
}

export function setupValid(day: number): boolean {
  return day >= 102 && day < 111;
}

const bulkCodeTable: Record<string, number> = { a75: 560, b34: 80, c85: 640 };

export function bulkCode(code: string): number {
  return bulkCodeTable[code] ?? 440;
}
