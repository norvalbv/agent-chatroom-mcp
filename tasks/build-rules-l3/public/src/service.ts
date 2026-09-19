import { toCents } from './units.ts';

export function archiveFree(units: number): number {
  return Math.min(units, 12) * 275;
}


export function rushQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 6 / 100);
}

export function insuranceFee(amount: number): number {
  return Math.floor(amount * 9 / 25);
}

export function priorityFee(amount: number): number {
  return Math.ceil(amount * 6 / 10);
}
