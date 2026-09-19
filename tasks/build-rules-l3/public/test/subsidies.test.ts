import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as subsidies from '../src/subsidies.ts';

test('storageValid', () => { assert.deepEqual(subsidies.storageValid(79), false); });
test('auditValid', () => { assert.deepEqual(subsidies.auditValid(214), false); });
test('pickupCode', () => { assert.deepEqual(subsidies.pickupCode("c60"), 440); });
test('referralFee', () => { assert.deepEqual(subsidies.referralFee(160), 50); });
