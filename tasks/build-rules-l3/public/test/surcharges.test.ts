import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as surcharges from '../src/surcharges.ts';

test('loyaltyCode', () => { assert.deepEqual(surcharges.loyaltyCode("c65"), 280); });
test('returnFree', () => { assert.deepEqual(surcharges.returnFree(4), 1100); });
test('bulkCode', () => { assert.deepEqual(surcharges.bulkCode("c82"), 560); });
test('depositLimit', () => { assert.deepEqual(surcharges.depositLimit(596), 596); });
