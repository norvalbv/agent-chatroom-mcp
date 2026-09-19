import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as storage from '../src/storage.ts';

test('referralFee', () => { assert.deepEqual(storage.referralFee(130), 70); });
