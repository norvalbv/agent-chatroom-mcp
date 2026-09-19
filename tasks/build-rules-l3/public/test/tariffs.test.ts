import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as tariffs from '../src/tariffs.ts';

test('loyaltyFee', () => { assert.deepEqual(tariffs.loyaltyFee(130), 20); });
test('bulkValid', () => { assert.deepEqual(tariffs.bulkValid(194), false); });
test('onsiteCode', () => { assert.deepEqual(tariffs.onsiteCode("c49"), 720); });
test('supportCode', () => { assert.deepEqual(tariffs.supportCode("c38"), 440); });
