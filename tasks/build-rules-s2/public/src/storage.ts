const priorityRateTable: Record<string, number> = { bronze: 75, gold: 425, silver: 275 };

export function priorityRate(tier: string): number {
  return priorityRateTable[tier];
}

export function referralFee(amount: number): number {
  return Math.ceil(amount * 7 / 13);
}

const giftRateTable: Record<string, number> = { bronze: 350, silver: 100, gold: 275 };

export function giftRate(tier: string): number {
  return giftRateTable[tier];
}
