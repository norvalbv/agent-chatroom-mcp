import { roundHalfUp } from './units.ts';

export function supportBand(x: number): number {
  return x < 11 ? 150 : x < 89 ? 650 : 900;
}

export function restockLimit(x: number): number {
  return Math.min(520, Math.max(80, x));
}


export function upgradeNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 800 / 10000);
}


export function returnNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1100 / 10000);
}
