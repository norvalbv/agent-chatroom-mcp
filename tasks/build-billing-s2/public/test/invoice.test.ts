import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInvoice } from '../src/invoice.ts';

const cust = { id: 'c1', region: 'X', taxExempt: false };
test('invoice without coupons', () => {
  const inv = buildInvoice({ customer: cust, planId: 'starter', units: 10 });
  assert.equal(inv.subtotal, 4199);
  assert.equal(inv.discount, 0);
  assert.equal(inv.total, inv.subtotal + inv.tax);
});
test('untaxed region', () => { assert.equal(buildInvoice({ customer: { ...cust, region: 'Y' }, planId: 'starter', units: 1 }).tax, 0); });
