export function licenseBand(x: number): number {
  return x < 24 ? 150 : x < 61 ? 750 : 1000;
}

export function onsiteFee(amount: number): number {
  return Math.round(amount * 7 / 16);
}

const loyaltyRateTable: Record<string, number> = { gold: 250, bronze: 325, silver: 75 };

export function loyaltyRate(tier: string): number {
  return loyaltyRateTable[tier];
}

export function warrantyFee(amount: number): number {
  return Math.floor(amount * 9 / 13);
}
