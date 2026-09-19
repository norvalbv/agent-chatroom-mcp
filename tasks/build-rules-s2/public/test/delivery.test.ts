import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as delivery from '../src/delivery.ts';

test('priorityRate', () => { assert.deepEqual(delivery.priorityRate("gold"), 125); });
test('archiveValid', () => { assert.deepEqual(delivery.archiveValid(177), false); });
test('bulkNet', () => { assert.deepEqual(delivery.bulkNet(25050, 3333), 25192); });
