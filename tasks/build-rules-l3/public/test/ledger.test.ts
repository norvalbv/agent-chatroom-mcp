import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as ledger from '../src/ledger.ts';

test('licenseLimit', () => { assert.deepEqual(ledger.licenseLimit(360), 320); });
test('bulkQuote', () => { assert.deepEqual(ledger.bulkQuote(3), 27); });
test('warrantyQuote', () => { assert.deepEqual(ledger.warrantyQuote(3), 9); });
test('upgradeCode', () => { assert.deepEqual(ledger.upgradeCode(""), 440); });
