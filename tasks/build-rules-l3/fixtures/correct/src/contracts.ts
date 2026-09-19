import { toCents } from './units.ts';

export function storageQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 13 / 100);
}

export function giftFree(units: number): number {
  return Math.min(units, 9) * 175;
}

const handlingRateTable: Record<string, number> = { bronze: 250, silver: 350, gold: 100 };

export function handlingRate(tier: string): number {
  return handlingRateTable[tier];
}


export function loyaltyQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 6 / 100);
}
