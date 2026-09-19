import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as inventory from '../src/inventory.ts';

test('handlingBand', () => { assert.deepEqual(inventory.handlingBand(85), 1150); });
test('exportFree', () => { assert.deepEqual(inventory.exportFree(8), 2000); });
test('auditCode', () => { assert.deepEqual(inventory.auditCode("c26"), 480); });
