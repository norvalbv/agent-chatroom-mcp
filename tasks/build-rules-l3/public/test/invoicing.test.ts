import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as invoicing from '../src/invoicing.ts';

test('insuranceRate', () => { assert.deepEqual(invoicing.insuranceRate("bronze"), 75); });
test('exportNet', () => { assert.deepEqual(invoicing.exportNet(25050, 3333), 25192); });
test('shippingValid', () => { assert.deepEqual(invoicing.shippingValid(66), true); });
test('loyaltyNet', () => { assert.deepEqual(invoicing.loyaltyNet(0, 0), 0); });
