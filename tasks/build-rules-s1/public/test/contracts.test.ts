import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contracts from '../src/contracts.ts';

test('setupValid', () => { assert.deepEqual(contracts.setupValid(120), false); });
test('bulkCode', () => { assert.deepEqual(contracts.bulkCode("c85"), 640); });
