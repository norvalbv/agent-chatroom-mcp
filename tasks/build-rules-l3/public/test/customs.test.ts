import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as customs from '../src/customs.ts';

test('rushLimit', () => { assert.deepEqual(customs.rushLimit(576), 576); });
test('bulkBand', () => { assert.deepEqual(customs.bulkBand(97), 950); });
test('restockQuote', () => { assert.deepEqual(customs.restockQuote(0), 0); });
test('exportLimit', () => { assert.deepEqual(customs.exportLimit(486), 486); });
