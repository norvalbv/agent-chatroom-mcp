import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contracts from '../src/contracts.ts';

test('depositCode', () => { assert.deepEqual(contracts.depositCode("c41"), 680); });
test('shippingBand', () => { assert.deepEqual(contracts.shippingBand(17), 200); });
test('seasonalQuote', () => { assert.deepEqual(contracts.seasonalQuote(0), 0); });
