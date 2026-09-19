import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as renewals from '../src/renewals.ts';

test('restockBand', () => { assert.deepEqual(renewals.restockBand(144), 900); });
test('depositNet', () => { assert.deepEqual(renewals.depositNet(0, 0), 0); });
test('archiveCode', () => { assert.deepEqual(renewals.archiveCode("c29"), 440); });
test('restockNet', () => { assert.deepEqual(renewals.restockNet(0, 0), 0); });
