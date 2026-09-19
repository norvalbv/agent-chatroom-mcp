import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as returns from '../src/returns.ts';

test('restockFee', () => { assert.deepEqual(returns.restockFee(1234), 664); });
test('rushValid', () => { assert.deepEqual(returns.rushValid(78), false); });
test('storageNet', () => { assert.deepEqual(returns.storageNet(25050, 3333), 26060); });
test('auditFee', () => { assert.deepEqual(returns.auditFee(1234), 112); });
