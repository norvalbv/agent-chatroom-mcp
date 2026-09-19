import { toCents } from './units.ts';

export function rushLimit(x: number): number {
  if (x >= 580) return 579;
  return Math.max(80, x);
}

export function bulkBand(x: number): number {
  return x < 14 ? 350 : x <= 57 ? 700 : 950;
}


export function restockQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 14 / 100);
}

export function exportLimit(x: number): number {
  if (x >= 490) return 489;
  return Math.max(70, x);
}
