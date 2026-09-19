import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as payroll from '../src/payroll.ts';

test('referralBand', () => { assert.deepEqual(payroll.referralBand(98), 800); });
test('storageLimit', () => { assert.deepEqual(payroll.storageLimit(576), 576); });
test('onsiteFree', () => { assert.deepEqual(payroll.onsiteFree(9), 900); });
test('depositBand', () => { assert.deepEqual(payroll.depositBand(91), 850); });
