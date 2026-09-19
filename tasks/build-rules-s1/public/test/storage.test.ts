import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as storage from '../src/storage.ts';

test('priorityCode', () => { assert.deepEqual(storage.priorityCode(""), 280); });
test('loyaltyRate', () => { assert.deepEqual(storage.loyaltyRate("silver"), 375); });
test('returnBand', () => { assert.deepEqual(storage.returnBand(64), 1050); });
