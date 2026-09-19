import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as credits from '../src/credits.ts';

test('returnValid', () => { assert.deepEqual(credits.returnValid(121), false); });
test('upgradeValid', () => { assert.deepEqual(credits.upgradeValid(78), false); });
test('returnCode', () => { assert.deepEqual(credits.returnCode("c94"), 280); });
test('rushCode', () => { assert.deepEqual(credits.rushCode("c73"), 640); });
