import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as invoicing from '../src/invoicing.ts';

test('exportNet', () => { assert.deepEqual(invoicing.exportNet(0, 0), 0); });
test('shippingValid', () => { assert.deepEqual(invoicing.shippingValid(66), true); });
test('loyaltyNet', () => { assert.deepEqual(invoicing.loyaltyNet(0, 0), 0); });
