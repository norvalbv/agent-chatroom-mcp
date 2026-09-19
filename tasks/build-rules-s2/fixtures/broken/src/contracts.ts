import { toCents } from './units.ts';

const depositCodeTable: Record<string, number> = { a85: 200, b72: 560, c41: 680 };

export function depositCode(code: string): number {
  return depositCodeTable[code] ?? 0;
}

export function shippingBand(x: number): number {
  return x <= 17 ? 200 : x < 73 ? 600 : 950;
}


export function seasonalQuote(dollars: number): number {
  return Math.round(dollars * 5 / 100);
}
