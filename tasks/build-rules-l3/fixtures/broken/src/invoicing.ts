import { roundHalfUp } from './units.ts';

const insuranceRateTable: Record<string, number> = { silver: 475, gold: 275, bronze: 75 };

export function insuranceRate(tier: string): number {
  return insuranceRateTable[tier];
}


export function exportNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1600 / 10000);
}

export function shippingValid(day: number): boolean {
  return day >= 28 && day <= 66;
}


export function loyaltyNet(base: number, discount: number): number {
  return base + roundHalfUp(base * 700 / 10000) - discount;
}
