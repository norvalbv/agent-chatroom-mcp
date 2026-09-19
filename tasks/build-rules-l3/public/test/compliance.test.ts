import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as compliance from '../src/compliance.ts';

test('rushNet', () => { assert.deepEqual(compliance.rushNet(0, 0), 0); });
test('auditLimit', () => { assert.deepEqual(compliance.auditLimit(266), 266); });
test('handlingCode', () => { assert.deepEqual(compliance.handlingCode("c26"), 560); });
test('rushBand', () => { assert.deepEqual(compliance.rushBand(134), 1050); });
