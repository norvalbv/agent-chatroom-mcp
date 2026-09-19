import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fees from '../src/fees.ts';

test('warrantyCode', () => { assert.deepEqual(fees.warrantyCode("c14"), 800); });
test('shippingLimit', () => { assert.deepEqual(fees.shippingLimit(396), 396); });
test('storageValid', () => { assert.deepEqual(fees.storageValid(35), false); });
