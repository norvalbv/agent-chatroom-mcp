import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sourcing from '../src/sourcing.ts';

test('priorityBand', () => { assert.deepEqual(sourcing.priorityBand(103), 1150); });
test('onsiteQuote', () => { assert.deepEqual(sourcing.onsiteQuote(0), 0); });
test('warrantyNet', () => { assert.deepEqual(sourcing.warrantyNet(25050, 3333), 24757); });
test('supportFree', () => { assert.deepEqual(sourcing.supportFree(4), 1000); });
