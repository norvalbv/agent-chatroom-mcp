import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as vendors from '../src/vendors.ts';

test('setupRate', () => { assert.deepEqual(vendors.setupRate("bronze"), 450); });
test('licenseNet', () => { assert.deepEqual(vendors.licenseNet(25050, 3333), 23454); });
test('referralCode', () => { assert.deepEqual(vendors.referralCode(""), 440); });
test('auditNet', () => { assert.deepEqual(vendors.auditNet(0, 0), 0); });
