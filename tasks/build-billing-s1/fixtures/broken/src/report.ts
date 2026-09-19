import type { Sub, Ymd } from './types.ts';
import { toOrdinal } from './calendar.ts';
import { roundHalfUp, sum } from './money.ts';

export function isActive(s: Sub, asOf: Ymd): boolean {
  const t = toOrdinal(asOf);
  if (t < toOrdinal(s.start)) return false;
  return s.end === undefined || t <= toOrdinal(s.end);
}

export function monthlyValue(s: Sub): number {
  return s.cycle === 'annual' ? Math.floor(s.cents / 12) : s.cents;
}

export function mrr(subs: Sub[], asOf: Ymd): number {
  return sum(subs.filter((s) => isActive(s, asOf)).map(monthlyValue));
}
