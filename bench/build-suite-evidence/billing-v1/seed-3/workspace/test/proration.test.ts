import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prorate, prorateCredit, remainingShare } from '../src/proration.ts';

test('thirty day period', () => { assert.equal(remainingShare({ y: 2025, m: 4, d: 1 }, { y: 2025, m: 5, d: 1 }, { y: 2025, m: 4, d: 16 }), 0.5); assert.equal(prorate(3000, { y: 2025, m: 4, d: 1 }, { y: 2025, m: 5, d: 1 }, { y: 2025, m: 4, d: 11 }), 2000); });
test('credit sign', () => { assert.equal(prorateCredit(3000, { y: 2025, m: 4, d: 1 }, { y: 2025, m: 5, d: 1 }, { y: 2025, m: 4, d: 11 }), -2000); });
