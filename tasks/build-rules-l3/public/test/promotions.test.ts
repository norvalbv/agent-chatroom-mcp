import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as promotions from '../src/promotions.ts';

test('archiveFee', () => { assert.deepEqual(promotions.archiveFee(220), 90); });
test('insuranceNet', () => { assert.deepEqual(promotions.insuranceNet(0, 0), 0); });
test('onsiteValid', () => { assert.deepEqual(promotions.onsiteValid(189), false); });
test('priorityNet', () => { assert.deepEqual(promotions.priorityNet(0, 0), 0); });
