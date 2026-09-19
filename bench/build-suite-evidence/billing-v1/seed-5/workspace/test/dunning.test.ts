import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lateFee } from '../src/dunning.ts';
import { addDays } from '../src/calendar.ts';

const due = { y: 2025, m: 6, d: 1 };
test('no fee well inside the grace period', () => { assert.equal(lateFee(10000, due, addDays(due, 1)), 0); });
test('fee well past the grace period', () => { assert.equal(lateFee(10000, due, addDays(due, 27)), Math.min(500, 3000)); });
test('fee applies once the grace period is used up', () => { assert.equal(lateFee(10000, due, addDays(due, 7)), 500); });
