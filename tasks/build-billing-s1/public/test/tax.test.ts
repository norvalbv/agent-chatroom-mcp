import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taxFor } from '../src/tax.ts';

test('regions', () => { assert.equal(taxFor('Y', 10000), 0); assert.equal(taxFor('Z', 10000), 500); assert.equal(taxFor('X', 10000), 700); assert.equal(taxFor('Q', 10000), 0); });
