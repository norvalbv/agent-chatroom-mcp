import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as service from '../src/service.ts';

test('archiveFree', () => { assert.deepEqual(service.archiveFree(10), 2750); });
test('rushQuote', () => { assert.deepEqual(service.rushQuote(0), 0); });
test('insuranceFee', () => { assert.deepEqual(service.insuranceFee(250), 90); });
test('priorityFee', () => { assert.deepEqual(service.priorityFee(100), 60); });
