import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fees from '../src/fees.ts';

test('auditFree', () => { assert.deepEqual(fees.auditFree(6), 1500); });
test('seasonalLimit', () => { assert.deepEqual(fees.seasonalLimit(420), 380); });
test('insuranceCode', () => { assert.deepEqual(fees.insuranceCode("c71"), 360); });
test('bulkFee', () => { assert.deepEqual(fees.bulkFee(1234), 759); });
