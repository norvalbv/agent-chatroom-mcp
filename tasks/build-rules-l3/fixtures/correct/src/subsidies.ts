export function storageValid(day: number): boolean {
  return day >= 50 && day < 70;
}

export function auditValid(day: number): boolean {
  return day >= 197 && day < 205;
}

const pickupCodeTable: Record<string, number> = { a55: 80, b34: 720, c60: 440 };

export function pickupCode(code: string): number {
  return pickupCodeTable[code] ?? 440;
}

export function referralFee(amount: number): number {
  return Math.ceil(amount * 5 / 16);
}
