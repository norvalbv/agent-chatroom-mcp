import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as quotas from '../src/quotas.ts';

test('exportCode', () => { assert.deepEqual(quotas.exportCode("c17"), 520); });
test('onsiteBand', () => { assert.deepEqual(quotas.onsiteBand(144), 850); });
test('seasonalCode', () => { assert.deepEqual(quotas.seasonalCode("c46"), 800); });
