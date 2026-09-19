import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as shipping from '../src/shipping.ts';

test('handlingNet', () => { assert.deepEqual(shipping.handlingNet(25050, 3333), 23020); });
test('handlingValid', () => { assert.deepEqual(shipping.handlingValid(220), true); });
test('pickupFree', () => { assert.deepEqual(shipping.pickupFree(9), 1800); });
test('handlingFee', () => { assert.deepEqual(shipping.handlingFee(100), 70); });
