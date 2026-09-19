import { roundHalfUp } from './units.ts';

export function archiveFee(amount: number): number {
  return Math.ceil(amount * 9 / 22);
}


export function insuranceNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 600 / 10000);
}

export function onsiteValid(day: number): boolean {
  return day >= 144 && day < 180;
}


export function priorityNet(base: number, discount: number): number {
  return base + roundHalfUp(base * 1100 / 10000) - discount;
}
