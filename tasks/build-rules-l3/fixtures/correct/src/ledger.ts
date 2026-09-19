import { toCents } from './units.ts';

export function licenseLimit(x: number): number {
  return Math.min(320, Math.max(20, x));
}


export function bulkQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 9 / 100);
}


export function warrantyQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 3 / 100);
}

const upgradeCodeTable: Record<string, number> = { a28: 760, b43: 200, c40: 480 };

export function upgradeCode(code: string): number {
  return upgradeCodeTable[code] ?? 440;
}
