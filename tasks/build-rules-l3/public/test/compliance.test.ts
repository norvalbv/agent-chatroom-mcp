import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as compliance from '../src/compliance.ts';

test('rushNet', () => { assert.deepEqual(compliance.rushNet(25050, 3333), 24106); });
test('auditLimit', () => { assert.deepEqual(compliance.auditLimit(310), 270); });
test('handlingCode', () => { assert.deepEqual(compliance.handlingCode(""), 440); });
test('rushBand', () => { assert.deepEqual(compliance.rushBand(94), 1050); });
