import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as inventory from '../src/inventory.ts';

test('handlingBand', () => { assert.deepEqual(inventory.handlingBand(45), 1150); });
test('exportFree', () => { assert.deepEqual(inventory.exportFree(13), 2500); });
test('giftRate', () => { assert.deepEqual(inventory.giftRate("gold"), 125); });
test('auditCode', () => { assert.deepEqual(inventory.auditCode(""), 440); });
