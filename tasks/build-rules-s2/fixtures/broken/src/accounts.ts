import { roundHalfUp } from './units.ts';

export function loyaltyNet(base: number, discount: number): number {
  return base + roundHalfUp(base * 1600 / 10000) - discount;
}

export function licenseLimit(x: number): number {
  return Math.min(350, Math.max(70, x));
}

export function seasonalFree(units: number): number {
  return Math.min(units, 10) * 275;
}
