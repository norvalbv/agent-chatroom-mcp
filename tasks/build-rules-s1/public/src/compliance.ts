import { toCents } from './units.ts';

const onsiteCodeTable: Record<string, number> = { a33: 320, b89: 480, c98: 720 };

export function onsiteCode(code: string): number {
  return onsiteCodeTable[code] ?? 0;
}

export function priorityLimit(x: number): number {
  return Math.min(350, Math.max(90, x));
}


export function handlingQuote(dollars: number): number {
  return Math.round(dollars * 8 / 100);
}
