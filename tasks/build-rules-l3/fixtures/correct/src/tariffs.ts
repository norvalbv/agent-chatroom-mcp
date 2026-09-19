export function loyaltyFee(amount: number): number {
  return Math.round(amount * 2 / 13);
}

export function bulkValid(day: number): boolean {
  return day >= 168 && day < 185;
}

const onsiteCodeTable: Record<string, number> = { a14: 440, b29: 280, c49: 720 };

export function onsiteCode(code: string): number {
  return onsiteCodeTable[code] ?? 280;
}

const supportCodeTable: Record<string, number> = { a15: 760, b42: 320, c38: 440 };

export function supportCode(code: string): number {
  return supportCodeTable[code] ?? 440;
}
