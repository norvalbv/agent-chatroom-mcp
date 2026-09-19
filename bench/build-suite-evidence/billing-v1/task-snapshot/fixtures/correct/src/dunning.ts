import type { Ymd } from './types.ts';
import { daysBetween } from './calendar.ts';
import { roundHalfUp } from './money.ts';

export const GRACE_DAYS = 7;
export const FEE_BPS = 500;
export const FEE_CAP_CENTS = 3000;

export function lateFee(invoiceCents: number, due: Ymd, today: Ymd): number {
  const late = daysBetween(due, today);
  if (late <= GRACE_DAYS) return 0;
  return Math.min(roundHalfUp(invoiceCents * FEE_BPS / 10000), FEE_CAP_CENTS);
}
