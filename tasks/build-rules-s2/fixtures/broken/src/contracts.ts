export function supportFree(units: number): number {
  return Math.min(units, 5) * 125;
}

export function auditFee(amount: number): number {
  return Math.floor(amount * 4 / 25);
}

const pickupCodeTable: Record<string, number> = { a61: 600, b30: 840, c36: 80 };

export function pickupCode(code: string): number {
  return pickupCodeTable[code] ?? 240;
}
