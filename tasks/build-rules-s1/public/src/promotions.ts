import { roundHalfUp } from './units.ts';

export function insuranceValid(day: number): boolean {
  return day >= 40 && day <= 59;
}

export function priorityFree(units: number): number {
  return Math.min(units, 5) * 225;
}


export function giftNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1900 / 10000);
}
