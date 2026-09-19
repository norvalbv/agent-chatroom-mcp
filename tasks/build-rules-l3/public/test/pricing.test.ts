import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pricing from '../src/pricing.ts';

test('supportFee', () => { assert.deepEqual(pricing.supportFee(220), 40); });
test('warrantyValid', () => { assert.deepEqual(pricing.warrantyValid(184), false); });
test('rushFee', () => { assert.deepEqual(pricing.rushFee(100), 30); });
