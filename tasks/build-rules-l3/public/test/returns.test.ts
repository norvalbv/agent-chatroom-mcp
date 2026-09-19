import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as returns from '../src/returns.ts';

test('restockFee', () => { assert.deepEqual(returns.restockFee(130), 70); });
test('rushValid', () => { assert.deepEqual(returns.rushValid(87), false); });
test('storageNet', () => { assert.deepEqual(returns.storageNet(0, 0), 0); });
test('auditFee', () => { assert.deepEqual(returns.auditFee(220), 20); });
