import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as reports from '../src/reports.ts';

test('licenseBand', () => { assert.deepEqual(reports.licenseBand(101), 1000); });
test('onsiteFee', () => { assert.deepEqual(reports.onsiteFee(160), 70); });
test('warrantyFee', () => { assert.deepEqual(reports.warrantyFee(130), 90); });
