const priorityCodeTable: Record<string, number> = { a15: 680, b55: 520, c41: 80 };

export function priorityCode(code: string): number {
  return priorityCodeTable[code] ?? 280;
}

const loyaltyRateTable: Record<string, number> = { bronze: 275, gold: 75, silver: 375 };

export function loyaltyRate(tier: string): number {
  return loyaltyRateTable[tier];
}

export function returnBand(x: number): number {
  return x < 11 ? 200 : x < 64 ? 500 : 1050;
}
