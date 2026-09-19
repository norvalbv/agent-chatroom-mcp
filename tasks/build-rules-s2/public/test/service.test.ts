import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as service from '../src/service.ts';

test('bulkValid', () => { assert.deepEqual(service.bulkValid(82), false); });
test('returnValid', () => { assert.deepEqual(service.returnValid(122), false); });
test('rushFee', () => { assert.deepEqual(service.rushFee(160), 80); });
