import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as storage from '../src/storage.ts';

test('priorityCode', () => { assert.deepEqual(storage.priorityCode("c41"), 80); });
test('returnBand', () => { assert.deepEqual(storage.returnBand(104), 1050); });
