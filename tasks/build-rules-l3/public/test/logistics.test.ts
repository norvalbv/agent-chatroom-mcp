import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as logistics from '../src/logistics.ts';

test('setupFree', () => { assert.deepEqual(logistics.setupFree(10), 2500); });
test('archiveQuote', () => { assert.deepEqual(logistics.archiveQuote(0), 0); });
test('handlingQuote', () => { assert.deepEqual(logistics.handlingQuote(0), 0); });
