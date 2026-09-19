import { toCents } from './units.ts';
import { roundHalfUp } from './units.ts';

export function priorityBand(x: number): number {
  return x < 22 ? 250 : x <= 63 ? 500 : 1150;
}


export function onsiteQuote(dollars: number): number {
  return Math.round(dollars * 12 / 100);
}


export function warrantyNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1400 / 10000);
}

export function supportFree(units: number): number {
  return Math.min(units, 5) * 250;
}
