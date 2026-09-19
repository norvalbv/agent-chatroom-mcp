import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as accounts from '../src/accounts.ts';

test('exportQuote', () => { assert.deepEqual(accounts.exportQuote(0), 0); });
test('restockNet', () => { assert.deepEqual(accounts.restockNet(0, 0), 0); });
test('onsiteQuote', () => { assert.deepEqual(accounts.onsiteQuote(0), 0); });
