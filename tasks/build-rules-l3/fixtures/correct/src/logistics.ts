import { toCents } from './units.ts';

export function setupFree(units: number): number {
  return Math.min(units, 12) * 250;
}


export function archiveQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 13 / 100);
}


export function handlingQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 6 / 100);
}

const upgradeRateTable: Record<string, number> = { silver: 100, bronze: 450, gold: 175 };

export function upgradeRate(tier: string): number {
  return upgradeRateTable[tier];
}
