import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Warehouse } from '../src/wh18/warehouse.ts';

test('receive and place', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', 30, 99, 0);
  assert.equal(w.place('o1', [{ sku: 'A', qty: 9 }], 1), 'reserved');
  assert.equal(w.snapshot(1).available.A, 21);
});

test('earliest expiry first', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', 9, 40, 0);
  w.receive('L2', 'A', 9, 30, 0);
  w.place('o1', [{ sku: 'A', qty: 6 }], 1);
  assert.deepEqual(w.snapshot(1).lots, [{ id: 'L1', qty: 9, reserved: 0 }, { id: 'L2', qty: 9, reserved: 6 }]);
});

test('ship and cancel', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', 24, 99, 0);
  w.place('o1', [{ sku: 'A', qty: 12 }], 1);
  assert.equal(w.ship('o1', 'A', 27), false);
  assert.equal(w.cancel('o1', 2), true);
  assert.equal(w.snapshot(2).available.A, 24);
});

test('backorder on a shortage and retry on receipt', () => {
  const w = new Warehouse();
  assert.equal(w.place('o1', [{ sku: 'A', qty: 6 }], 0), 'backordered');
  w.receive('L1', 'A', 15, 99, 1);
  assert.equal(w.snapshot(1).orders[0].status, 'reserved');
});

test('return within what shipped', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', 24, 99, 0);
  w.place('o1', [{ sku: 'A', qty: 12 }], 1);
  w.ship('o1', 'A', 12);
  assert.equal(w.returnItems('o1', 'A', 6, 2), true);
  assert.equal(w.returnItems('o1', 'A', 27, 2), false);
});
