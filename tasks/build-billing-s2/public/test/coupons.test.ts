import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCoupons } from '../src/coupons.ts';

test('single percent', () => { assert.deepEqual(applyCoupons(10000, [{ code: 'A', kind: 'percent', value: 1000 }]), { discount: 1000, total: 9000 }); });
test('single fixed', () => { assert.deepEqual(applyCoupons(10000, [{ code: 'B', kind: 'fixed', value: 500 }]), { discount: 500, total: 9500 }); });
test('none', () => { assert.deepEqual(applyCoupons(10000, []), { discount: 0, total: 10000 }); });
