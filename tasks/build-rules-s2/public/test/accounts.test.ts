import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as accounts from '../src/accounts.ts';

test('loyaltyNet', () => { assert.deepEqual(accounts.loyaltyNet(0, 0), 0); });
test('licenseLimit', () => { assert.deepEqual(accounts.licenseLimit(346), 346); });
test('seasonalFree', () => { assert.deepEqual(accounts.seasonalFree(8), 2200); });
