import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pricing from '../src/pricing.ts';

test('supportFee', () => { assert.deepEqual(pricing.supportFee(1234), 225); });
test('warrantyValid', () => { assert.deepEqual(pricing.warrantyValid(175), false); });
test('rushFee', () => { assert.deepEqual(pricing.rushFee(1234), 370); });
test('bulkRate', () => { assert.deepEqual(pricing.bulkRate("gold"), 325); });
