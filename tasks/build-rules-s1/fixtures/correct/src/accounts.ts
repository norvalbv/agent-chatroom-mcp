import { toCents } from './units.ts';
import { roundHalfUp } from './units.ts';

export function exportQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 4 / 100);
}


export function restockNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 700 / 10000);
}


export function onsiteQuote(dollars: number): number {
  return Math.round(toCents(dollars) * 12 / 100);
}
