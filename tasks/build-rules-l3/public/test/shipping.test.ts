import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as shipping from '../src/shipping.ts';

test('handlingNet', () => { assert.deepEqual(shipping.handlingNet(0, 0), 0); });
test('handlingValid', () => { assert.deepEqual(shipping.handlingValid(220), true); });
test('pickupFree', () => { assert.deepEqual(shipping.pickupFree(4), 1200); });
test('handlingFee', () => { assert.deepEqual(shipping.handlingFee(100), 70); });
