import type { Ymd } from './types.ts';
import { daysBetween } from './calendar.ts';
import { roundHalfUp } from './money.ts';

export function remainingShare(start: Ymd, end: Ymd, from: Ymd): number {
  const total = daysBetween(start, end);
  return daysBetween(from, end) / total;
}

export function prorate(cents: number, start: Ymd, end: Ymd, from: Ymd): number {
  return roundHalfUp(cents * remainingShare(start, end, from));
}

export function prorateCredit(cents: number, start: Ymd, end: Ymd, from: Ymd): number {
  return roundHalfUp(-cents * remainingShare(start, end, from));
}
