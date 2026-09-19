import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as renewals from '../src/renewals.ts';

test('restockBand', () => { assert.deepEqual(renewals.restockBand(104), 900); });
test('depositNet', () => { assert.deepEqual(renewals.depositNet(25050, 3333), 23454); });
test('archiveCode', () => { assert.deepEqual(renewals.archiveCode(""), 320); });
test('restockNet', () => { assert.deepEqual(renewals.restockNet(25050, 3333), 23672); });
