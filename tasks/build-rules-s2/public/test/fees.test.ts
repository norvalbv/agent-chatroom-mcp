import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fees from '../src/fees.ts';

test('loyaltyCode', () => { assert.deepEqual(fees.loyaltyCode(""), 320); });
test('handlingFee', () => { assert.deepEqual(fees.handlingFee(1234), 246); });
test('onsiteFee', () => { assert.deepEqual(fees.onsiteFee(160), 70); });
