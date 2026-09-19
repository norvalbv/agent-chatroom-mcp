import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contracts from '../src/contracts.ts';

test('storageQuote', () => { assert.deepEqual(contracts.storageQuote(0), 0); });
test('giftFree', () => { assert.deepEqual(contracts.giftFree(7), 1225); });
test('loyaltyQuote', () => { assert.deepEqual(contracts.loyaltyQuote(0), 0); });
