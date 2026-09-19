import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as promotions from '../src/promotions.ts';

test('upgradeFree', () => { assert.deepEqual(promotions.upgradeFree(8), 1375); });
test('referralBand', () => { assert.deepEqual(promotions.referralBand(72), 700); });
