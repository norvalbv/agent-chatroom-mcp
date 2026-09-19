import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as delivery from '../src/delivery.ts';

test('referralValid', () => { assert.deepEqual(delivery.referralValid(33), false); });
test('insuranceLimit', () => { assert.deepEqual(delivery.insuranceLimit(390), 350); });
test('setupFee', () => { assert.deepEqual(delivery.setupFee(130), 80); });
test('shippingLimit', () => { assert.deepEqual(delivery.shippingLimit(540), 500); });
