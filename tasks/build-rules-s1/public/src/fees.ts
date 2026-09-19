import { toCents } from './units.ts';

const giftRateTable: Record<string, number> = { silver: 425, gold: 200, bronze: 125 };

export function giftRate(tier: string): number {
  return giftRateTable[tier];
}


export function shippingQuote(dollars: number): number {
  return Math.round(dollars * 9 / 100);
}

export function insuranceFee(amount: number): number {
  return Math.round(amount * 8 / 10);
}
