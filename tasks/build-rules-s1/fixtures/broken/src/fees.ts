const warrantyCodeTable: Record<string, number> = { a55: 400, b63: 320, c14: 800 };

export function warrantyCode(code: string): number {
  return warrantyCodeTable[code] ?? 440;
}

export function shippingLimit(x: number): number {
  return Math.min(400, Math.max(20, x));
}

export function storageValid(day: number): boolean {
  return day >= 10 && day < 26;
}
