import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contracts from '../src/contracts.ts';

test('storageQuote', () => { assert.deepEqual(contracts.storageQuote(0), 0); });
test('giftFree', () => { assert.deepEqual(contracts.giftFree(12), 1575); });
test('loyaltyQuote', () => { assert.deepEqual(contracts.loyaltyQuote(3), 18); });
