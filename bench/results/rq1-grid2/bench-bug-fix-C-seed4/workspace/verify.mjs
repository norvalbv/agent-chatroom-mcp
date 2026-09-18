import assert from 'node:assert/strict';
import { inclusiveDates } from './dates.ts';

assert.deepEqual(inclusiveDates('2024-01-01', '2024-01-03'), ['2024-01-01', '2024-01-02', '2024-01-03']);
assert.deepEqual(inclusiveDates('2024-01-01', '2024-01-01'), ['2024-01-01']);
assert.deepEqual(inclusiveDates('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01']);

for (const [s, e] of [
  ['2024-02-30', '2024-03-01'],
  ['2024-03-01', '2024-01-01'],
  ['2024-1-1', '2024-01-01'],
  ['not-a-date', '2024-01-01'],
]) {
  assert.throws(() => inclusiveDates(s, e), /invalid date range/);
}

console.log('all checks passed');
