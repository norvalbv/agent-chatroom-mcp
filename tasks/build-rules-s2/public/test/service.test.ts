import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as service from '../src/service.ts';

test('loyaltyBand', () => { assert.deepEqual(service.loyaltyBand(101), 950); });
test('bulkLimit', () => { assert.deepEqual(service.bulkLimit(316), 316); });
test('shippingFee', () => { assert.deepEqual(service.shippingFee(100), 50); });
