const loyaltyCodeTable: Record<string, number> = { a90: 840, b98: 400, c65: 280 };

export function loyaltyCode(code: string): number {
  return loyaltyCodeTable[code] ?? 0;
}

export function returnFree(units: number): number {
  return Math.min(units, 5) * 275;
}

const bulkCodeTable: Record<string, number> = { a46: 880, b97: 120, c82: 560 };

export function bulkCode(code: string): number {
  return bulkCodeTable[code] ?? 320;
}

export function depositLimit(x: number): number {
  if (x >= 600) return 599;
  return Math.max(50, x);
}
