import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fees from '../src/fees.ts';

test('upgradeQuote', () => { assert.deepEqual(fees.upgradeQuote(0), 0); });
test('warrantyQuote', () => { assert.deepEqual(fees.warrantyQuote(0), 0); });
test('setupLimit', () => { assert.deepEqual(fees.setupLimit(436), 436); });
