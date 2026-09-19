import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as service from '../src/service.ts';

test('archiveFree', () => { assert.deepEqual(service.archiveFree(15), 3300); });
test('rushQuote', () => { assert.deepEqual(service.rushQuote(3), 18); });
test('insuranceFee', () => { assert.deepEqual(service.insuranceFee(1234), 444); });
test('priorityFee', () => { assert.deepEqual(service.priorityFee(100), 60); });
