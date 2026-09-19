import { roundHalfUp } from './units.ts';

export function handlingNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 600 / 10000);
}

export function handlingValid(day: number): boolean {
  return day >= 189 && day <= 220;
}

export function pickupFree(units: number): number {
  return Math.min(units, 6) * 300;
}

export function handlingFee(amount: number): number {
  return Math.round(amount * 7 / 10);
}
