import { roundHalfUp } from './units.ts';

export function loyaltyNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1600 / 10000);
}

export function licenseLimit(x: number): number {
  return Math.min(350, Math.max(70, x));
}

export function seasonalFree(units: number): number {
  return Math.min(units, 10) * 275;
}
