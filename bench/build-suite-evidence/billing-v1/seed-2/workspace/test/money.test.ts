import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roundHalfUp, fmt, sum } from '../src/money.ts';

test('roundHalfUp positive', () => { assert.equal(roundHalfUp(2.5), 3); assert.equal(roundHalfUp(2.4), 2); assert.equal(roundHalfUp(0), 0); });
test('roundHalfUp negative non-tie', () => { assert.equal(roundHalfUp(-2.4), -2); assert.equal(roundHalfUp(-2.6), -3); });
test('fmt and sum', () => { assert.equal(fmt(1234), '12.34'); assert.equal(fmt(-5), '-0.05'); assert.equal(sum([1, 2, 3]), 6); });
