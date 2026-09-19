export function auditFree(units: number): number {
  return Math.min(units, 7) * 250;
}

export function seasonalLimit(x: number): number {
  return Math.min(380, Math.max(90, x));
}

const insuranceCodeTable: Record<string, number> = { a22: 880, b66: 520, c71: 360 };

export function insuranceCode(code: string): number {
  return insuranceCodeTable[code] ?? 0;
}

export function bulkFee(amount: number): number {
  return Math.floor(amount * 8 / 13);
}
