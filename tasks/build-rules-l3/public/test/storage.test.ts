import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as storage from '../src/storage.ts';

test('supportBand', () => { assert.deepEqual(storage.supportBand(129), 900); });
test('restockLimit', () => { assert.deepEqual(storage.restockLimit(516), 516); });
test('upgradeNet', () => { assert.deepEqual(storage.upgradeNet(0, 0), 0); });
test('returnNet', () => { assert.deepEqual(storage.returnNet(0, 0), 0); });
