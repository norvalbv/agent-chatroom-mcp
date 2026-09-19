import { toCents } from './units.ts';

export function depositLimit(x: number): number {
  return Math.min(200, Math.max(70, x));
}

export function archiveValid(day: number): boolean {
  return day >= 142 && day < 168;
}


export function storageQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 11 / 100);
}
