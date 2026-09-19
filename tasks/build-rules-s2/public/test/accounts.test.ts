import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as accounts from '../src/accounts.ts';

test('licenseCode', () => { assert.deepEqual(accounts.licenseCode(""), 400); });
test('shippingValid', () => { assert.deepEqual(accounts.shippingValid(154), true); });
test('referralNet', () => { assert.deepEqual(accounts.referralNet(25050, 3333), 25843); });
