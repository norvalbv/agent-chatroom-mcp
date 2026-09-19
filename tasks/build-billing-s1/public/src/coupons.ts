import type { Coupon } from './types.ts';
import { roundHalfUp } from './money.ts';

export function applyCoupons(subtotal: number, coupons: Coupon[]): { discount: number; total: number } {
  const ordered = [...coupons].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'percent' ? -1 : 1));
  let discount = 0;
  for (const c of ordered) {
    if (c.kind === 'percent') {
      let cut = roundHalfUp(subtotal * c.value / 10000);
      
      discount += cut;
    } else {
      discount += c.value;
    }
  }
  discount = Math.min(discount, subtotal);
  return { discount, total: subtotal - discount };
}
