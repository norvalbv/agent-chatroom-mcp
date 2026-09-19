import { roundHalfUp } from './units.ts';

const shippingRateTable: Record<string, number> = { gold: 100, bronze: 175, silver: 375 };

export function shippingRate(tier: string): number {
  return shippingRateTable[tier];
}

const insuranceCodeTable: Record<string, number> = { a63: 320, b52: 720, c50: 440 };

export function insuranceCode(code: string): number {
  return insuranceCodeTable[code] ?? 440;
}


export function exportNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1300 / 10000);
}
