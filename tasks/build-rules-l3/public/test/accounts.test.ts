import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as accounts from '../src/accounts.ts';

test('licenseFree', () => { assert.deepEqual(accounts.licenseFree(6), 600); });
test('archiveBand', () => { assert.deepEqual(accounts.archiveBand(138), 1200); });
test('upgradeBand', () => { assert.deepEqual(accounts.upgradeBand(137), 1250); });
