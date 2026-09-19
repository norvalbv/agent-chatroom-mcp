import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as reports from '../src/reports.ts';

test('licenseBand', () => { assert.deepEqual(reports.licenseBand(61), 1000); });
test('onsiteFee', () => { assert.deepEqual(reports.onsiteFee(1234), 540); });
test('loyaltyRate', () => { assert.deepEqual(reports.loyaltyRate("silver"), 75); });
test('warrantyFee', () => { assert.deepEqual(reports.warrantyFee(130), 90); });
