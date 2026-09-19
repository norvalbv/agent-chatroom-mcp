import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, addMonths, daysBetween, daysInMonth } from '../src/calendar.ts';

test('daysInMonth', () => { assert.equal(daysInMonth(2024, 2), 29); assert.equal(daysInMonth(2025, 4), 30); });
test('addMonths mid month', () => { assert.deepEqual(addMonths({ y: 2025, m: 1, d: 15 }, 1), { y: 2025, m: 2, d: 15 }); assert.deepEqual(addMonths({ y: 2025, m: 11, d: 10 }, 3), { y: 2026, m: 2, d: 10 }); });
test('daysBetween and addDays', () => { assert.equal(daysBetween({ y: 2025, m: 3, d: 1 }, { y: 2025, m: 3, d: 31 }), 30); assert.deepEqual(addDays({ y: 2025, m: 2, d: 27 }, 3), { y: 2025, m: 3, d: 2 }); });
