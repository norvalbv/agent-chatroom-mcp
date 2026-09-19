import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as compliance from '../src/compliance.ts';

test('handlingLimit', () => { assert.deepEqual(compliance.handlingLimit(256), 256); });
test('restockFree', () => { assert.deepEqual(compliance.restockFree(3), 300); });
