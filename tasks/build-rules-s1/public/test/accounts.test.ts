import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as accounts from '../src/accounts.ts';

test('warrantyQuote', () => { assert.deepEqual(accounts.warrantyQuote(0), 0); });
test('auditFee', () => { assert.deepEqual(accounts.auditFee(1234), 664); });
test('referralLimit', () => { assert.deepEqual(accounts.referralLimit(390), 350); });
