import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as refunds from '../src/refunds.ts';

test('shippingFree', () => { assert.deepEqual(refunds.shippingFree(8), 1800); });
test('insuranceBand', () => { assert.deepEqual(refunds.insuranceBand(152), 900); });
test('handlingLimit', () => { assert.deepEqual(refunds.handlingLimit(366), 366); });
