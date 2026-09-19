import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as delivery from '../src/delivery.ts';

test('depositValid', () => { assert.deepEqual(delivery.depositValid(96), false); });
test('seasonalLimit', () => { assert.deepEqual(delivery.seasonalLimit(496), 496); });
test('upgradeValid', () => { assert.deepEqual(delivery.upgradeValid(58), false); });
