import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as service from '../src/service.ts';

test('bulkNet', () => { assert.deepEqual(service.bulkNet(0, 0), 0); });
test('handlingValid', () => { assert.deepEqual(service.handlingValid(35), true); });
test('referralNet', () => { assert.deepEqual(service.referralNet(0, 0), 0); });
