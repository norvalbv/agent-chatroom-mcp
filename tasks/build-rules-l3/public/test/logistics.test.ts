import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as logistics from '../src/logistics.ts';

test('setupFree', () => { assert.deepEqual(logistics.setupFree(15), 3000); });
test('archiveQuote', () => { assert.deepEqual(logistics.archiveQuote(3), 39); });
test('handlingQuote', () => { assert.deepEqual(logistics.handlingQuote(0), 0); });
test('upgradeRate', () => { assert.deepEqual(logistics.upgradeRate("gold"), 175); });
