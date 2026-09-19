import { roundHalfUp } from './units.ts';

export function restockFee(amount: number): number {
  return Math.round(amount * 7 / 13);
}

export function rushValid(day: number): boolean {
  return day >= 57 && day < 78;
}


export function storageNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 2000 / 10000);
}

export function auditFee(amount: number): number {
  return Math.round(amount * 2 / 22);
}
