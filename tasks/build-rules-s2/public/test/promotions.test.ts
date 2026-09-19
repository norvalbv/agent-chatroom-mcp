import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as promotions from '../src/promotions.ts';

test('supportValid', () => { assert.deepEqual(promotions.supportValid(109), false); });
test('onsiteValid', () => { assert.deepEqual(promotions.onsiteValid(73), false); });
test('archiveCode', () => { assert.deepEqual(promotions.archiveCode(""), 240); });
