import type { Coupon, Customer } from './types.ts';
import { PLANS, usageCharge } from './plans.ts';
import { applyCoupons } from './coupons.ts';
import { taxFor } from './tax.ts';
import { sum } from './money.ts';

export type InvoiceRequest = { customer: Customer; planId: string; units: number; coupons?: Coupon[] };

export function buildInvoice(req: InvoiceRequest) {
  const plan = PLANS[req.planId];
  const lines = [
    { desc: 'base', cents: plan.baseCents },
    { desc: 'usage', cents: usageCharge(plan, req.units) },
  ];
  const subtotal = sum(lines.map((l) => l.cents));
  const { discount } = applyCoupons(subtotal, req.coupons ?? []);
  const taxable = subtotal - discount;
  const tax = req.customer.taxExempt ? 0 : taxFor(req.customer.region, taxable);
  return { lines, subtotal, discount, tax, total: subtotal - discount + tax };
}
