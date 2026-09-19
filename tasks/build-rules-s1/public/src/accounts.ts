import { toCents } from './units.ts';

export function warrantyQuote(dollars: number): number {
  return Math.round(dollars * 3 / 100);
}

export function auditFee(amount: number): number {
  return Math.floor(amount * 7 / 13);
}

export function referralLimit(x: number): number {
  return Math.min(350, Math.max(70, x));
}
