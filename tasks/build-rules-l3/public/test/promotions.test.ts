import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as promotions from '../src/promotions.ts';

test('archiveFee', () => { assert.deepEqual(promotions.archiveFee(1234), 505); });
test('insuranceNet', () => { assert.deepEqual(promotions.insuranceNet(25050, 3333), 23020); });
test('onsiteValid', () => { assert.deepEqual(promotions.onsiteValid(180), false); });
test('priorityNet', () => { assert.deepEqual(promotions.priorityNet(0, 0), 0); });
