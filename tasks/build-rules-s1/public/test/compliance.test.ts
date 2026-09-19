import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as compliance from '../src/compliance.ts';

test('loyaltyFree', () => { assert.deepEqual(compliance.loyaltyFree(8), 1925); });
test('seasonalBand', () => { assert.deepEqual(compliance.seasonalBand(91), 900); });
test('rushFree', () => { assert.deepEqual(compliance.rushFree(1), 150); });
