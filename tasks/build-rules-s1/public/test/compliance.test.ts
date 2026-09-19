import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as compliance from '../src/compliance.ts';

test('onsiteCode', () => { assert.deepEqual(compliance.onsiteCode("c98"), 720); });
test('priorityLimit', () => { assert.deepEqual(compliance.priorityLimit(346), 346); });
test('handlingQuote', () => { assert.deepEqual(compliance.handlingQuote(0), 0); });
