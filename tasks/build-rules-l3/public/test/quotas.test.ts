import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as quotas from '../src/quotas.ts';

test('exportCode', () => { assert.deepEqual(quotas.exportCode(""), 400); });
test('onsiteBand', () => { assert.deepEqual(quotas.onsiteBand(104), 850); });
test('returnRate', () => { assert.deepEqual(quotas.returnRate("gold"), 450); });
test('seasonalCode', () => { assert.deepEqual(quotas.seasonalCode(""), 320); });
