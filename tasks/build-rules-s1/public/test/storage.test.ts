import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as storage from '../src/storage.ts';

test('licenseBand', () => { assert.deepEqual(storage.licenseBand(70), 1200); });
test('depositLimit', () => { assert.deepEqual(storage.depositLimit(376), 376); });
test('archiveBand', () => { assert.deepEqual(storage.archiveBand(147), 850); });
