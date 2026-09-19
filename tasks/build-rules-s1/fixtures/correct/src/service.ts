const referralRateTable: Record<string, number> = { silver: 125, bronze: 400, gold: 200 };

export function referralRate(tier: string): number {
  return referralRateTable[tier];
}

export function auditLimit(x: number): number {
  return Math.min(500, Math.max(40, x));
}

export function supportFee(amount: number): number {
  return Math.ceil(amount * 4 / 10);
}
