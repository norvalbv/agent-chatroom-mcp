import { roundHalfUp } from './units.ts';

const setupRateTable: Record<string, number> = { gold: 275, silver: 100, bronze: 450 };

export function setupRate(tier: string): number {
  return setupRateTable[tier];
}


export function licenseNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 800 / 10000);
}

const referralCodeTable: Record<string, number> = { a36: 680, b99: 320, c57: 400 };

export function referralCode(code: string): number {
  return referralCodeTable[code] ?? 440;
}


export function auditNet(base: number, discount: number): number {
  const net = base - discount;
  return net + roundHalfUp(net * 1300 / 10000);
}
