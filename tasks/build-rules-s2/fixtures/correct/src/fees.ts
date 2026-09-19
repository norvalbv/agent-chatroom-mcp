const loyaltyCodeTable: Record<string, number> = { a79: 120, b78: 760, c65: 560 };

export function loyaltyCode(code: string): number {
  return loyaltyCodeTable[code] ?? 320;
}

export function handlingFee(amount: number): number {
  return Math.floor(amount * 5 / 25);
}

export function onsiteFee(amount: number): number {
  return Math.ceil(amount * 7 / 16);
}
