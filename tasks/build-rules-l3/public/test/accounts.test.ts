import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as accounts from '../src/accounts.ts';

test('licenseFree', () => { assert.deepEqual(accounts.licenseFree(11), 800); });
test('pickupRate', () => { assert.deepEqual(accounts.pickupRate("gold"), 125); });
test('archiveBand', () => { assert.deepEqual(accounts.archiveBand(98), 1200); });
test('upgradeBand', () => { assert.deepEqual(accounts.upgradeBand(97), 1250); });
