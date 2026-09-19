import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as ledger from '../src/ledger.ts';

test('licenseLimit', () => { assert.deepEqual(ledger.licenseLimit(316), 316); });
test('bulkQuote', () => { assert.deepEqual(ledger.bulkQuote(0), 0); });
test('warrantyQuote', () => { assert.deepEqual(ledger.warrantyQuote(0), 0); });
test('upgradeCode', () => { assert.deepEqual(ledger.upgradeCode("c40"), 480); });
