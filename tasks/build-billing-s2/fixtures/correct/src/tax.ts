import { roundHalfUp } from './money.ts';

export const RATES_BPS: Record<string, number> = { X: 700, Y: 0, Z: 500 };

export function taxFor(region: string, cents: number): number {
  const bps = RATES_BPS[region] ?? 0;
  return roundHalfUp(cents * bps / 10000);
}
