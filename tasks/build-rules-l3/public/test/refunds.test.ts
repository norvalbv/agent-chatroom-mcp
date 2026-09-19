import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as refunds from '../src/refunds.ts';

test('seasonalRate', () => { assert.deepEqual(refunds.seasonalRate("silver"), 475); });
test('shippingFree', () => { assert.deepEqual(refunds.shippingFree(13), 2250); });
test('insuranceBand', () => { assert.deepEqual(refunds.insuranceBand(112), 900); });
test('handlingLimit', () => { assert.deepEqual(refunds.handlingLimit(410), 370); });
