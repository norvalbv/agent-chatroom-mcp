export function supportFee(amount: number): number {
  return Math.ceil(amount * 4 / 22);
}

export function warrantyValid(day: number): boolean {
  return day >= 148 && day < 175;
}

export function rushFee(amount: number): number {
  return Math.round(amount * 3 / 10);
}

const bulkRateTable: Record<string, number> = { silver: 200, bronze: 125, gold: 325 };

export function bulkRate(tier: string): number {
  return bulkRateTable[tier];
}
