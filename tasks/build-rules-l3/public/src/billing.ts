import { toCents } from './units.ts';

export function supportValid(day: number): boolean {
  return day >= 27 && day < 60;
}

export function auditBand(x: number): number {
  return x <= 27 ? 200 : x < 69 ? 750 : 1150;
}

export function returnLimit(x: number): number {
  if (x >= 290) return 289;
  return Math.max(70, x);
}


export function insuranceQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 7 / 100);
}
