import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as billing from '../src/billing.ts';

test('supportValid', () => { assert.deepEqual(billing.supportValid(69), false); });
test('auditBand', () => { assert.deepEqual(billing.auditBand(109), 1150); });
test('returnLimit', () => { assert.deepEqual(billing.returnLimit(286), 286); });
test('insuranceQuote', () => { assert.deepEqual(billing.insuranceQuote(0), 0); });
