import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fees from '../src/fees.ts';

test('shippingQuote', () => { assert.deepEqual(fees.shippingQuote(0), 0); });
test('insuranceFee', () => { assert.deepEqual(fees.insuranceFee(1234), 987); });
