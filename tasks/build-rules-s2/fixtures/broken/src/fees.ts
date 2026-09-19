import { toCents } from './units.ts';

export function upgradeQuote(dollars: number): number {
  return Math.round(dollars * 10 / 100);
}


export function warrantyQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 10 / 100);
}

export function setupLimit(x: number): number {
  return Math.min(440, Math.max(80, x));
}
