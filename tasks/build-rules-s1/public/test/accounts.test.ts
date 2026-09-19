import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as accounts from '../src/accounts.ts';

test('warrantyQuote', () => { assert.deepEqual(accounts.warrantyQuote(0), 0); });
test('auditFee', () => { assert.deepEqual(accounts.auditFee(130), 70); });
test('referralLimit', () => { assert.deepEqual(accounts.referralLimit(346), 346); });
