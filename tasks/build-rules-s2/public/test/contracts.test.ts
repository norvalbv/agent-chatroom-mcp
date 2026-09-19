import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contracts from '../src/contracts.ts';

test('supportFree', () => { assert.deepEqual(contracts.supportFree(3), 375); });
test('auditFee', () => { assert.deepEqual(contracts.auditFee(250), 40); });
test('pickupCode', () => { assert.deepEqual(contracts.pickupCode("c36"), 80); });
