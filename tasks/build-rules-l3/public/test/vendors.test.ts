import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as vendors from '../src/vendors.ts';

test('licenseNet', () => { assert.deepEqual(vendors.licenseNet(0, 0), 0); });
test('referralCode', () => { assert.deepEqual(vendors.referralCode("c57"), 400); });
test('auditNet', () => { assert.deepEqual(vendors.auditNet(0, 0), 0); });
