import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fees from '../src/fees.ts';

test('loyaltyCode', () => { assert.deepEqual(fees.loyaltyCode("c65"), 560); });
test('handlingFee', () => { assert.deepEqual(fees.handlingFee(250), 50); });
test('onsiteFee', () => { assert.deepEqual(fees.onsiteFee(160), 70); });
