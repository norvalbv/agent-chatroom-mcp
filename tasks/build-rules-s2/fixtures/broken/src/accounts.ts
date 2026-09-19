import { roundHalfUp } from './units.ts';

const licenseCodeTable: Record<string, number> = { a24: 160, b23: 400, c17: 760 };

export function licenseCode(code: string): number {
  return licenseCodeTable[code] ?? 400;
}

export function shippingValid(day: number): boolean {
  return day >= 139 && day <= 154;
}


export function referralNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1900 / 10000);
}
