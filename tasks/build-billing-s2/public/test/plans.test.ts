import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLANS, usageCharge } from '../src/plans.ts';

test('usage inside first tier', () => { assert.equal(usageCharge(PLANS.starter, 10), 10 * 20); assert.equal(usageCharge(PLANS.starter, 0), 0); });
test('usage just inside first tier', () => { assert.equal(usageCharge(PLANS.starter, 199), 199 * 20); });
