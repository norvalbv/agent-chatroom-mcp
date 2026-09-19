import { roundHalfUp } from './units.ts';

export function rushNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1100 / 10000);
}

export function auditLimit(x: number): number {
  return Math.min(270, Math.max(60, x));
}

const handlingCodeTable: Record<string, number> = { a81: 720, b76: 320, c26: 560 };

export function handlingCode(code: string): number {
  return handlingCodeTable[code] ?? 440;
}

export function rushBand(x: number): number {
  return x < 28 ? 250 : x < 94 ? 500 : 1050;
}
