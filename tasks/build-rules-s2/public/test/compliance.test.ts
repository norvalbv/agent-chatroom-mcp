import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as compliance from '../src/compliance.ts';

test('insuranceCode', () => { assert.deepEqual(compliance.insuranceCode("c50"), 440); });
test('exportNet', () => { assert.deepEqual(compliance.exportNet(0, 0), 0); });
