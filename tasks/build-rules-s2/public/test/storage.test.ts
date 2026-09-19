import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as storage from '../src/storage.ts';

test('returnFree', () => { assert.deepEqual(storage.returnFree(10), 1250); });
test('supportBand', () => { assert.deepEqual(storage.supportBand(110), 1000); });
