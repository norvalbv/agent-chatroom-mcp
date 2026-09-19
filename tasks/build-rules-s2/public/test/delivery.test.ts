import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as delivery from '../src/delivery.ts';

test('archiveValid', () => { assert.deepEqual(delivery.archiveValid(186), false); });
test('bulkNet', () => { assert.deepEqual(delivery.bulkNet(0, 0), 0); });
