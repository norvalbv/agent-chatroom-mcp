import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Warehouse } from '../src/wh03/warehouse.ts';

test('receive and place', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', 10, 99, 0);
  assert.equal(w.place('o1', [{ sku: 'A', qty: 3 }], 1), 'reserved');
  assert.equal(w.snapshot(1).available.A, 7);
});

test('earliest expiry first', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', 3, 40, 0);
  w.receive('L2', 'A', 3, 30, 0);
  w.place('o1', [{ sku: 'A', qty: 2 }], 1);
  assert.deepEqual(w.snapshot(1).lots, [{ id: 'L1', qty: 3, reserved: 0 }, { id: 'L2', qty: 3, reserved: 2 }]);
});

test('ship and cancel', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', 8, 99, 0);
  w.place('o1', [{ sku: 'A', qty: 4 }], 1);
  assert.equal(w.ship('o1', 'A', 9), false);
  assert.equal(w.cancel('o1', 2), true);
  assert.equal(w.snapshot(2).available.A, 8);
});

test('backorder on a shortage and retry on receipt', () => {
  const w = new Warehouse();
  assert.equal(w.place('o1', [{ sku: 'A', qty: 2 }], 0), 'backordered');
  w.receive('L1', 'A', 5, 99, 1);
  assert.equal(w.snapshot(1).orders[0].status, 'reserved');
});

test('return within what shipped', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', 8, 99, 0);
  w.place('o1', [{ sku: 'A', qty: 4 }], 1);
  w.ship('o1', 'A', 4);
  assert.equal(w.returnItems('o1', 'A', 2, 2), true);
  assert.equal(w.returnItems('o1', 'A', 9, 2), false);
});
