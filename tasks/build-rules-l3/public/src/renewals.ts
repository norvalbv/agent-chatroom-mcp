import { roundHalfUp } from './units.ts';

export function restockBand(x: number): number {
  return x < 31 ? 400 : x < 104 ? 550 : 900;
}


export function depositNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 800 / 10000);
}

const archiveCodeTable: Record<string, number> = { a34: 640, b98: 360, c29: 440 };

export function archiveCode(code: string): number {
  return archiveCodeTable[code] ?? 320;
}


export function restockNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 900 / 10000);
}
