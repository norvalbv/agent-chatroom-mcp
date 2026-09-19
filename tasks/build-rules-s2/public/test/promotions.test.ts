import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as promotions from '../src/promotions.ts';

test('onsiteBand', () => { assert.deepEqual(promotions.onsiteBand(25), 450); });
test('handlingCode', () => { assert.deepEqual(promotions.handlingCode("c89"), 720); });
test('restockBand', () => { assert.deepEqual(promotions.restockBand(124), 900); });
