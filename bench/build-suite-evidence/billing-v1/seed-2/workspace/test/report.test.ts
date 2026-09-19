import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isActive, mrr } from '../src/report.ts';

const subs = [
  { id: 's1', planId: 'starter', cycle: 'monthly' as const, cents: 5000, start: { y: 2025, m: 1, d: 10 } },
  { id: 's2', planId: 'growth', cycle: 'annual' as const, cents: 12000, start: { y: 2025, m: 2, d: 1 } },
];
test('mrr', () => { assert.equal(mrr(subs, { y: 2025, m: 3, d: 1 }), 6000); assert.equal(mrr(subs, { y: 2025, m: 1, d: 20 }), 5000); });
test('active before start and open ended', () => { assert.equal(isActive(subs[0], { y: 2025, m: 1, d: 9 }), false); assert.equal(isActive(subs[0], { y: 2030, m: 1, d: 9 }), true); });
