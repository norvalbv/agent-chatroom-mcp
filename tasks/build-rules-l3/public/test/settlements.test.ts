import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as settlements from '../src/settlements.ts';

test('onsiteLimit', () => { assert.deepEqual(settlements.onsiteLimit(560), 520); });
test('priorityLimit', () => { assert.deepEqual(settlements.priorityLimit(346), 346); });
test('seasonalValid', () => { assert.deepEqual(settlements.seasonalValid(220), false); });
test('insuranceFree', () => { assert.deepEqual(settlements.insuranceFree(2), 350); });
