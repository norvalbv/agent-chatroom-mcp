/** Hidden checks: D* = one per defect (passes only if that defect is fixed); R* = regression behaviours that hold
 * in the original code. Expected values are frozen from the correct build into expected.json. */
const d = (y: number, m: number, dd: number) => ({ y, m, d: dd });
export const CHECKS: Record<string, (m: any, p: any) => unknown> = {
  D01: (m) => [m.money.roundHalfUp(-2.5), m.money.roundHalfUp(-0.5), m.money.roundHalfUp(-1234.5)],
  D02: (m) => [m.calendar.addMonths(d(2025, 1, 31), 1), m.calendar.addMonths(d(2024, 1, 31), 1), m.calendar.addMonths(d(2025, 8, 31), 6)],
  D03: (m, p) => [m.plans.usageCharge(m.plans.PLANS.starter, p.tierA + 1), m.plans.usageCharge(m.plans.PLANS.starter, p.tierB + 7), m.plans.usageCharge(m.plans.PLANS.growth, p.tierA * 2 + 3)],
  D04: (m, p) => [m.proration.prorate(4999, d(2025, 3, 1), d(2025, 4, 1), d(2025, 3, 11)), m.proration.remainingShare(d(2025, 2, 1), d(2025, 3, 1), d(2025, 2, 15))],
  D05: (m) => [m.coupons.applyCoupons(10000, [{ code: 'F', kind: 'fixed', value: 500 }, { code: 'P', kind: 'percent', value: 1000 }])],
  D06: (m) => [m.coupons.applyCoupons(3000, [{ code: 'F', kind: 'fixed', value: 5000 }]), m.coupons.applyCoupons(3000, [{ code: 'P', kind: 'percent', value: 4000 }, { code: 'F', kind: 'fixed', value: 2500 }])],
  D07: (m) => [m.coupons.applyCoupons(10000, [{ code: 'P', kind: 'percent', value: 5000, maxCents: 1000 }])],
  D08: (m) => [m.invoice.buildInvoice({ customer: { id: 'c', region: 'X', taxExempt: false }, planId: 'starter', units: 30, coupons: [{ code: 'F', kind: 'fixed', value: 1000 }] })],
  D09: (m) => [m.invoice.buildInvoice({ customer: { id: 'c', region: 'X', taxExempt: true }, planId: 'growth', units: 12 }).tax],
  D10: (m, p) => [m.dunning.lateFee(20000, d(2025, 6, 1), m.calendar.addDays(d(2025, 6, 1), p.grace)), m.dunning.lateFee(20000, d(2025, 6, 1), m.calendar.addDays(d(2025, 6, 1), p.grace + 1))],
  D11: (m) => { const s = { id: 's', planId: 'starter', cycle: 'monthly', cents: 5000, start: d(2025, 1, 1), end: d(2025, 4, 1) }; return [m.report.isActive(s, d(2025, 3, 31)), m.report.isActive(s, d(2025, 4, 1)), m.report.mrr([s], d(2025, 4, 1))]; },
  D12: (m) => [m.report.monthlyValue({ id: 's', planId: 'growth', cycle: 'annual', cents: 10007, start: d(2025, 1, 1) }), m.report.mrr([{ id: 'a', planId: 'growth', cycle: 'annual', cents: 20011, start: d(2025, 1, 1) }], d(2025, 2, 1))],
  R01: (m) => [m.money.roundHalfUp(2.5), m.money.roundHalfUp(-2.4), m.money.roundHalfUp(-2.6), m.money.fmt(-1999), m.money.sum([5, 6])],
  R02: (m) => [m.calendar.addMonths(d(2025, 1, 15), 13), m.calendar.addMonths(d(2025, 3, 30), 1), m.calendar.addMonths(d(2025, 12, 5), 1), m.calendar.addMonths(d(2025, 3, 10), -3)],
  R03: (m) => [m.calendar.daysBetween(d(2024, 2, 1), d(2024, 3, 1)), m.calendar.addDays(d(2024, 2, 28), 2), m.calendar.daysInMonth(2100, 2)],
  R04: (m, p) => [m.plans.usageCharge(m.plans.PLANS.starter, 0), m.plans.usageCharge(m.plans.PLANS.starter, 7), m.plans.usageCharge(m.plans.PLANS.growth, 5), m.plans.usageCharge(m.plans.PLANS.starter, p.tierA - 1)],
  R05: (m) => [m.proration.prorate(3000, d(2025, 4, 1), d(2025, 5, 1), d(2025, 4, 11)), m.proration.prorateCredit(3000, d(2025, 4, 1), d(2025, 5, 1), d(2025, 4, 11)), m.proration.prorate(3000, d(2025, 4, 1), d(2025, 5, 1), d(2025, 5, 1))],
  R06: (m) => [m.coupons.applyCoupons(10000, [{ code: 'P', kind: 'percent', value: 1500 }]), m.coupons.applyCoupons(8000, [{ code: 'F', kind: 'fixed', value: 700 }]), m.coupons.applyCoupons(500, [])],
  R07: (m) => [m.coupons.applyCoupons(10000, [{ code: 'P', kind: 'percent', value: 2000, maxCents: 5000 }]), m.coupons.applyCoupons(10000, [{ code: 'P', kind: 'percent', value: 2000 }])],
  R08: (m) => [m.tax.taxFor('X', 12345), m.tax.taxFor('Z', 999), m.tax.taxFor('Y', 5000), m.tax.taxFor('?', 5000)],
  R09: (m) => [m.invoice.buildInvoice({ customer: { id: 'c', region: 'Y', taxExempt: false }, planId: 'starter', units: 5 }), m.invoice.buildInvoice({ customer: { id: 'c', region: 'Z', taxExempt: false }, planId: 'growth', units: 3 })],
  R10: (m, p) => [m.dunning.lateFee(10000, d(2025, 6, 1), m.calendar.addDays(d(2025, 6, 1), 2)), m.dunning.lateFee(10000, d(2025, 6, 1), m.calendar.addDays(d(2025, 6, 1), p.grace + 30)), m.dunning.lateFee(9999999, d(2025, 6, 1), m.calendar.addDays(d(2025, 6, 1), p.grace + 30))],
  R11: (m) => { const s = { id: 's', planId: 'starter', cycle: 'monthly', cents: 5000, start: d(2025, 1, 10) }; return [m.report.isActive(s, d(2025, 1, 9)), m.report.isActive(s, d(2025, 1, 10)), m.report.isActive(s, d(2031, 1, 1))]; },
  R12: (m) => [m.report.mrr([{ id: 'a', planId: 'growth', cycle: 'annual', cents: 12000, start: d(2025, 1, 1) }, { id: 'b', planId: 'starter', cycle: 'monthly', cents: 4999, start: d(2025, 1, 1) }], d(2025, 6, 1))],
};
