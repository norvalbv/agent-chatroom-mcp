import { roundHalfUp } from './units.ts';

const priorityRateTable: Record<string, number> = { silver: 350, bronze: 225, gold: 125 };

export function priorityRate(tier: string): number {
  return priorityRateTable[tier];
}

export function archiveValid(day: number): boolean {
  return day >= 139 && day < 177;
}


export function bulkNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1600 / 10000);
}
