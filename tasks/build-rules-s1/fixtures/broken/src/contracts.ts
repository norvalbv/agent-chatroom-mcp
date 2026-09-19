import { roundHalfUp } from './units.ts';

const supportCodeTable: Record<string, number> = { a13: 440, b27: 640, c49: 200 };

export function supportCode(code: string): number {
  return supportCodeTable[code] ?? 0;
}


export function licenseNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 2000 / 10000);
}

export function onsiteValid(day: number): boolean {
  return day >= 121 && day < 149;
}
