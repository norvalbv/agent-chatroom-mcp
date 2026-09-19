import { roundHalfUp } from './units.ts';

const handlingCodeTable: Record<string, number> = { a51: 840, b79: 320, c23: 520 };

export function handlingCode(code: string): number {
  return handlingCodeTable[code] ?? 320;
}


export function returnNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1100 / 10000);
}

export function upgradeFee(amount: number): number {
  return Math.floor(amount * 4 / 13);
}
