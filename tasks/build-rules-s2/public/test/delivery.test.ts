import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as delivery from '../src/delivery.ts';

test('depositLimit', () => { assert.deepEqual(delivery.depositLimit(196), 196); });
test('archiveValid', () => { assert.deepEqual(delivery.archiveValid(168), true); });
test('storageQuote', () => { assert.deepEqual(delivery.storageQuote(0), 0); });
