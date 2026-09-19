import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as promotions from '../src/promotions.ts';

test('insuranceValid', () => { assert.deepEqual(promotions.insuranceValid(59), true); });
test('priorityFree', () => { assert.deepEqual(promotions.priorityFree(4), 900); });
test('giftNet', () => { assert.deepEqual(promotions.giftNet(0, 0), 0); });
