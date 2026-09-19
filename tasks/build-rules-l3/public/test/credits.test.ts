import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as credits from '../src/credits.ts';

test('returnValid', () => { assert.deepEqual(credits.returnValid(121), false); });
test('upgradeValid', () => { assert.deepEqual(credits.upgradeValid(69), false); });
test('returnCode', () => { assert.deepEqual(credits.returnCode(""), 440); });
test('rushCode', () => { assert.deepEqual(credits.rushCode(""), 360); });
