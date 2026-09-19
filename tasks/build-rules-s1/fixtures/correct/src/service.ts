import { roundHalfUp } from './units.ts';

export function bulkNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1000 / 10000);
}

export function handlingValid(day: number): boolean {
  return day >= 22 && day < 35;
}


export function referralNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1000 / 10000);
}
