/** Generator for the stateful family (tasks/build-ledger-s<seed>): an order-fulfilment warehouse (lots with expiry,
 * FEFO reservation, partial shipment, cancel, returns, backorder queue) in six modules, a SPEC.md that describes
 * behaviour in prose, and 9 of 12 catalogued state-machine defects planted. There is no per-function value table to diff:
 * a defect is a missing rollback, a leaked counter, a wrong trigger; each is found by tracing a call path across modules.
 * Hidden checks are scenario scripts whose snapshots are frozen from the correct build.
 *   node --import tsx scripts/bench-build-ledger-gen.ts <seed> [--out dir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Repo root of THIS generator, baked as a literal into every generated oracle/score.ts so the private-scorer child
// process resolves tsx (and everything else) the same way regardless of the caller's cwd or where a task instance
// is generated to (fable-review G2: a scorer that inherits the caller's cwd is cwd-dependent and can silently fail).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const LEDGER_DEFECTS = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12', 'S13', 'S14'] as const;
export const LEDGER_KIND: Record<string, string> = { S01: 'cross-module-contract', S02: 'spec-vs-code', S03: 'boundary', S04: 'cross-module-contract', S05: 'cross-module-contract', S06: 'boundary', S07: 'spec-vs-code', S08: 'spec-vs-code', S09: 'cross-module-contract', S10: 'spec-vs-code', S11: 'cross-module-contract', S12: 'cross-module-contract', S13: 'cross-module-contract', S14: 'cross-module-contract' };
export type LedgerInstance = { seed: number; m: number; defects: string[] };

function rng(seed: number) {
  let a = (seed * 2654435761 >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function deriveLedger(seed: number): LedgerInstance {
  const r = rng(seed);
  const ids = [...LEDGER_DEFECTS] as string[];
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return { seed, m: 1 + Math.floor(r() * 3), defects: ids.slice(0, 9).sort() };
}

export function buildLedgerSrc(inst: LedgerInstance, fixed: Set<string>): Record<string, string> {
  const raw = buildLedgerRaw(inst, fixed);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.replace(/^[ \t]+\n/gm, '')]));
}

function buildLedgerRaw(inst: LedgerInstance, fixed: Set<string>): Record<string, string> {
  const bad = (id: string) => inst.defects.includes(id) && !fixed.has(id);
  return {
    'types.ts': `export type Line = { sku: string; qty: number };
export type Lot = { id: string; sku: string; qty: number; expiry: number };
export type Alloc = { lotId: string; qty: number; back?: number };
`,
    'inventory.ts': `import type { Alloc, Lot } from './types.ts';

export class Inventory {
  lots = new Map<string, Lot>();
  reserved = new Map<string, number>();

  receive(id: string, sku: string, qty: number, expiry: number): void {
    const existing = this.lots.get(id);
    if (existing) {
      existing.qty = ${bad('S10') ? 'qty' : 'existing.qty + qty'};
    } else {
      this.lots.set(id, { id, sku, qty, expiry });
    }
  }

  usable(lot: Lot, day: number): boolean {
    return lot.expiry ${bad('S03') ? '>' : '>='} day;
  }

  free(lot: Lot): number {
    return lot.qty - (this.reserved.get(lot.id) ?? 0);
  }

  available(sku: string, day: number): number {
    let total = 0;
    for (const lot of this.lots.values()) {
      if (lot.sku === sku && ${bad('S11') ? 'this.free(lot) > 0' : 'this.usable(lot, day)'}) total += this.free(lot);
    }
    return total;
  }

  plan(sku: string, qty: number, day: number): Alloc[] | null {
    const candidates = [...this.lots.values()].filter((l) => l.sku === sku && this.usable(l, day) && this.free(l) > 0);
    candidates.sort((a, b) => a.expiry - b.expiry || (a.id < b.id ? ${bad('S02') ? '1' : '-1'} : a.id > b.id ? ${bad('S02') ? '-1' : '1'} : 0));
    const out: Alloc[] = [];
    let need = qty;
    for (const lot of candidates) {
      if (need <= 0) break;
      const take = Math.min(need, this.free(lot));
      out.push({ lotId: lot.id, qty: take });
      need -= take;
    }
    return need > 0 ? null : out;
  }

  hold(allocs: Alloc[]): void {
    for (const a of allocs) this.reserved.set(a.lotId, (this.reserved.get(a.lotId) ?? 0) + a.qty);
  }

  unhold(allocs: Alloc[]): void {
    for (const a of allocs) this.reserved.set(a.lotId, (this.reserved.get(a.lotId) ?? 0) - a.qty);
  }

  consume(a: Alloc): void {
    const lot = this.lots.get(a.lotId)!;
    lot.qty -= a.qty;
    this.reserved.set(a.lotId, (this.reserved.get(a.lotId) ?? 0) - a.qty);
  }
}
`,
    'orders.ts': `import type { Alloc, Line } from './types.ts';
import type { Inventory } from './inventory.ts';

export type Order = {
  id: string;
  lines: Line[];
  status: 'reserved' | 'backordered' | 'cancelled';
  remaining: Map<string, Alloc[]>;
  shipped: Map<string, Alloc[]>;
  returned: Map<string, number>;
};

export function tryReserve(inv: Inventory, order: Order, day: number): boolean {
  const held: Alloc[] = [];
  const perSku = new Map<string, Alloc[]>();
  let ok = true;
  for (const line of order.lines) {
    const plan = inv.plan(line.sku, line.qty, day);
    if (!plan) { ok = false; break; }
    inv.hold(plan);
    held.push(...plan);
    perSku.set(line.sku, ${bad('S14') ? 'plan' : '[...(perSku.get(line.sku) ?? []), ...plan]'});
  }
  if (!ok) {
    inv.unhold(${bad('S01') ? 'perSku.get(order.lines[0].sku) ?? []' : 'held'});
    order.status = 'backordered';
    return false;
  }
  order.remaining = perSku;
  order.status = 'reserved';
  return true;
}

export function total(allocs: Alloc[] | undefined): number {
  return (allocs ?? []).reduce((a, b) => a + b.qty, 0);
}
`,
    'backorder.ts': `import type { Inventory } from './inventory.ts';
import { tryReserve, total } from './orders.ts';
import type { Order } from './orders.ts';

export class Backorders {
  queue: string[] = [];

  add(id: string): void {
    if (!this.queue.includes(id)) this.queue.push(id);
  }

  remove(id: string): void {
    this.queue = this.queue.filter((x) => x !== id);
  }

  retry(inv: Inventory, orders: Map<string, Order>, day: number): void {
    const ids = ${bad('S08') ? '[...this.queue].sort((a, b) => size(orders.get(a)!) - size(orders.get(b)!))' : '[...this.queue]'};
    for (const id of ids) {
      const order = orders.get(id)!;
      if (order.status ${bad('S12') ? "=== 'reserved'" : "!== 'backordered'"}) { this.remove(id); continue; }
      if (tryReserve(inv, order, day)) this.remove(id);
    }
  }
}

function size(o: Order): number {
  return o.lines.reduce((a, l) => a + l.qty, 0);
}
`,
    'warehouse.ts': `import type { Line } from './types.ts';
import { Inventory } from './inventory.ts';
import { Backorders } from './backorder.ts';
import { tryReserve, total } from './orders.ts';
import type { Order } from './orders.ts';

export class Warehouse {
  inv = new Inventory();
  orders = new Map<string, Order>();
  backorders = new Backorders();

  receive(id: string, sku: string, qty: number, expiry: number, day: number): void {
    this.inv.receive(id, sku, qty, expiry);
    this.backorders.retry(this.inv, this.orders, day);
  }

  place(id: string, lines: Line[], day: number): string {
    const order: Order = { id, lines, status: 'backordered', remaining: new Map(), shipped: new Map(), returned: new Map() };
    this.orders.set(id, order);
    if (!tryReserve(this.inv, order, day)) this.backorders.add(id);
    return order.status;
  }

  ship(id: string, sku: string, qty: number): boolean {
    const order = this.orders.get(id);
    if (!order || order.status !== 'reserved') return false;
    const remaining = order.remaining.get(sku) ?? [];
    if (qty <= 0 || qty > ${bad('S04') ? "(order.lines.find((l) => l.sku === sku)?.qty ?? 0)" : 'total(remaining)'}) return false;
    let need = qty;
    const shipped = order.shipped.get(sku) ?? [];
    for (const a of remaining) {
      if (need <= 0) break;
      const take = Math.min(need, a.qty);
      this.inv.consume({ lotId: a.lotId, qty: take });
      a.qty -= take;
      shipped.push({ lotId: a.lotId, qty: take, back: 0 });
      need -= take;
    }
    order.remaining.set(sku, remaining.filter((a) => a.qty > 0));
    order.shipped.set(sku, shipped);
    return true;
  }

  cancel(id: string, day: number): boolean {
    const order = this.orders.get(id);
    if (!order || order.status === 'cancelled') return false;
    ${bad('S09') ? 'this.backorders.retry(this.inv, this.orders, day);' : ''}
    if (order.status === 'reserved') {
      for (const map of ${bad('S05') ? '[order.remaining, order.shipped]' : '[order.remaining]'}) for (const allocs of map.values()) this.inv.unhold(allocs);
      order.remaining = new Map();
    }
    order.status = 'cancelled';
    ${bad('S09') ? '' : 'this.backorders.retry(this.inv, this.orders, day);'}
    return true;
  }

  returnItems(id: string, sku: string, qty: number, day: number): boolean {
    const order = this.orders.get(id);
    if (!order) return false;
    const shippedQty = total(order.shipped.get(sku));
    const already = order.returned.get(sku) ?? 0;
    if (qty <= 0 || qty > shippedQty${bad('S06') ? '' : ' - already'}) return false;
    order.returned.set(sku, already + qty);
    let left = qty;
    for (const a of [...(order.shipped.get(sku) ?? [])].reverse()) {
      if (left <= 0) break;
      const take = Math.min(left, a.qty${bad('S13') ? '' : ' - (a.back ?? 0)'});
      a.back = (a.back ?? 0) + take;
      const lot = this.inv.lots.get(a.lotId)!;
      if (${bad('S07') ? 'lot.expiry >= day - 1' : 'this.inv.usable(lot, day)'}) lot.qty += take;
      left -= take;
    }
    this.backorders.retry(this.inv, this.orders, day);
    return true;
  }

  snapshot(day: number) {
    const skus = [...new Set([...this.inv.lots.values()].map((l) => l.sku))].sort();
    return {
      lots: [...this.inv.lots.values()].map((l) => ({ id: l.id, qty: l.qty, reserved: this.inv.reserved.get(l.id) ?? 0 })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      orders: [...this.orders.values()].map((o) => ({ id: o.id, status: o.status, remaining: Object.fromEntries([...o.remaining].map(([k, v]) => [k, total(v)])), shipped: Object.fromEntries([...o.shipped].map(([k, v]) => [k, total(v)])), returned: Object.fromEntries([...o.returned]) })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      backorders: [...this.backorders.queue],
      available: Object.fromEntries(skus.map((s) => [s, this.inv.available(s, day)])),
    };
  }
}
`,
  };
}

const SPEC = `# Warehouse fulfilment specification

The \`Warehouse\` class in \`src/warehouse.ts\` tracks stock in lots. All quantities are whole units; days are integers.

## Stock and expiry
- A lot has an id, a sku, a quantity on hand and an expiry day. A lot may be used on its expiry day and not on any later day.
- Receiving stock into a lot id that already exists adds to that lot; it never replaces its quantity.
- The stock a sku has available on a day is the on-hand quantity of its lots that can be used on that day, minus what is reserved from them.
  Expired lots contribute nothing.

## Reserving
- Placing an order reserves every line from lots that can be used that day, earliest expiry first; lots with the same expiry are used in
  order of their id. A line may be filled from several lots.
- Reserving is all or nothing per order. If any line cannot be filled in full, the order becomes backordered and holds no stock at all.
- A cancelled order is never reserved again.
- Backordered orders are retried whenever stock becomes available again: on a receipt, on a cancellation and on a return.
  They are retried in the order they were placed.

## Shipping, cancelling and returning
- Shipping takes units out of an order's reservation and off the shelf. Units can be shipped in several steps; shipping more than is still
  reserved for that sku is refused. Once units have shipped, they are no longer reserved.
- Cancelling an order releases only the units that are still reserved for it; units already shipped stay shipped.
- Order lines may repeat a sku; their quantities add up.
- A return puts units back on the shelf in the lot they came from, latest shipped units first. The units returned for a sku may never total
  more than was shipped for it; a return that would exceed that is refused and changes nothing. Units returning to a lot that can no longer
  be used that day are discarded instead of restocked.

## Snapshot
- \`snapshot(day)\` reports lots (quantity and reserved), orders (status, \`remaining\` units still reserved per sku, \`shipped\` units per sku
  counted gross, that is not reduced by later returns, and \`returned\` units per sku), the backorder queue and the available stock per sku on
  that day. Its shape is a frozen interface: do not add, rename or reorder fields.
`;
const BRIEF = `The warehouse library in src/ must meet the specification in SPEC.md. The public tests in test/ pass today, but passing them does not prove the code meets the specification. Make the codebase conform to SPEC.md, keeping everything that already conforms working. Run the tests with: node --test test/*.test.ts. Do not create files outside this directory.`;

type Scn = (W: any, m: number) => unknown;
const S = (w: any) => w;
export const SCENARIOS: Record<string, Scn> = {
  S01: (W, m) => { const w = new W(); w.receive('L1', 'A', 5 * m, 100, 0); w.receive('L2', 'B', 5 * m, 100, 0); const s1 = w.place('o1', [{ sku: 'A', qty: 2 * m }, { sku: 'B', qty: 2 * m }, { sku: 'C', qty: 1 }], 1); const s2 = w.place('o2', [{ sku: 'A', qty: 5 * m }, { sku: 'B', qty: 5 * m }], 1); return [s1, s2, w.snapshot(1)]; },
  S02: (W, m) => { const w = new W(); w.receive('L2', 'A', 3 * m, 50, 0); w.receive('L1', 'A', 3 * m, 50, 0); w.place('o1', [{ sku: 'A', qty: 2 * m }], 1); return w.snapshot(1); },
  S03: (W, m) => { const w = new W(); w.receive('L1', 'A', 4 * m, 10, 0); const s = w.place('o1', [{ sku: 'A', qty: 2 * m }], 10); return [s, w.snapshot(10)]; },
  S04: (W, m) => { const w = new W(); w.receive('L1', 'A', 10 * m, 99, 0); w.place('o1', [{ sku: 'A', qty: 4 * m }], 1); const a = w.ship('o1', 'A', 3 * m); const b = w.ship('o1', 'A', 3 * m); return [a, b, w.snapshot(2)]; },
  S05: (W, m) => { const w = new W(); w.receive('L1', 'A', 10 * m, 99, 0); w.place('o1', [{ sku: 'A', qty: 6 * m }], 1); w.ship('o1', 'A', 2 * m); const c = w.cancel('o1', 2); return [c, w.snapshot(2)]; },
  S06: (W, m) => { const w = new W(); w.receive('L1', 'A', 10 * m, 99, 0); w.place('o1', [{ sku: 'A', qty: 5 * m }], 1); w.ship('o1', 'A', 5 * m); const r = [w.returnItems('o1', 'A', 3 * m, 2), w.returnItems('o1', 'A', 2 * m, 2), w.returnItems('o1', 'A', 1, 2)]; return [r, w.snapshot(2)]; },
  S07: (W, m) => { const w = new W(); w.receive('L1', 'A', 10 * m, 20, 0); w.place('o1', [{ sku: 'A', qty: 4 * m }], 5); w.ship('o1', 'A', 4 * m); const r = w.returnItems('o1', 'A', 4 * m, 21); return [r, w.snapshot(21).lots]; },
  S08: (W, m) => { const w = new W(); w.place('o1', [{ sku: 'A', qty: 5 * m }], 0); w.place('o2', [{ sku: 'A', qty: 1 * m }], 0); w.place('o3', [{ sku: 'A', qty: 3 * m }], 0); w.receive('L9', 'A', 6 * m, 99, 1); return w.snapshot(1); },
  S09: (W, m) => { const w = new W(); w.receive('L1', 'A', 3 * m, 99, 0); w.place('o1', [{ sku: 'A', qty: 3 * m }], 1); w.place('o2', [{ sku: 'A', qty: 3 * m }], 1); w.cancel('o1', 2); return w.snapshot(2); },
  S10: (W, m) => { const w = new W(); w.receive('L1', 'A', 5 * m, 99, 0); w.receive('L1', 'A', 3 * m, 99, 0); return w.snapshot(1); },
  S11: (W, m) => { const w = new W(); w.receive('L1', 'A', 5 * m, 10, 0); w.receive('L2', 'A', 2 * m, 30, 0); return [w.snapshot(11).available, w.snapshot(12).available]; },
  S12: (W, m) => { const w = new W(); w.place('o1', [{ sku: 'A', qty: 2 * m }], 0); w.cancel('o1', 0); w.receive('L1', 'A', 5 * m, 99, 1); const sn = w.snapshot(1); return [sn.orders, sn.lots, sn.available]; },
  S13: (W, m) => { const w = new W(); w.receive('L1', 'A', 6 * m, 99, 0); w.receive('L2', 'A', 6 * m, 120, 0); w.place('o1', [{ sku: 'A', qty: 8 * m }], 3); w.ship('o1', 'A', 8 * m); const a = w.returnItems('o1', 'A', 2 * m, 4); const b = w.returnItems('o1', 'A', 2 * m, 4); return [a, b, w.snapshot(4)]; },
  S14: (W, m) => { const w = new W(); w.receive('L1', 'A', 10 * m, 99, 0); w.place('o1', [{ sku: 'A', qty: 2 * m }, { sku: 'A', qty: 2 * m }], 1); w.cancel('o1', 2); return w.snapshot(2); },
  R01: (W, m) => { const w = new W(); w.receive('L1', 'A', 10 * m, 99, 0); w.receive('L2', 'B', 4 * m, 99, 0); const s = w.place('o1', [{ sku: 'A', qty: 3 * m }, { sku: 'B', qty: 2 * m }], 1); return [s, w.snapshot(1)]; },
  R02: (W, m) => { const w = new W(); w.receive('L1', 'A', 3 * m, 40, 0); w.receive('L2', 'A', 3 * m, 30, 0); w.place('o1', [{ sku: 'A', qty: 4 * m }], 1); return w.snapshot(1); },
  R03: (W, m) => { const w = new W(); w.receive('L1', 'A', 10 * m, 99, 0); w.place('o1', [{ sku: 'A', qty: 4 * m }], 1); const a = w.ship('o1', 'A', 1 * m); const b = w.ship('o1', 'A', 9 * m); const c = w.ship('o1', 'A', 3 * m); return [a, b, c]; },
  R04: (W, m) => { const w = new W(); w.receive('L1', 'A', 4 * m, 99, 0); w.place('o1', [{ sku: 'A', qty: 4 * m }], 1); w.place('o2', [{ sku: 'A', qty: 2 * m }], 1); w.receive('L2', 'A', 5 * m, 99, 2); return w.snapshot(2); },
  R05: (W, m) => { const w = new W(); w.receive('L1', 'A', 8 * m, 99, 0); w.place('o1', [{ sku: 'A', qty: 4 * m }], 1); const c1 = w.cancel('o1', 2); const c2 = w.cancel('o1', 2); const c3 = w.cancel('nope', 2); return [c1, c2, c3, w.snapshot(2)]; },
  R06: (W, m) => { const w = new W(); w.receive('L1', 'A', 8 * m, 99, 0); w.place('o1', [{ sku: 'A', qty: 4 * m }], 1); w.ship('o1', 'A', 4 * m); const r = w.returnItems('o1', 'A', 2 * m, 2); const bad = w.returnItems('o1', 'A', 0, 2); const bad2 = w.returnItems('zz', 'A', 1, 2); return [r, bad, bad2, w.snapshot(2)]; },
  R07: (W, m) => { const w = new W(); w.receive('L1', 'A', 2 * m, 99, 0); w.place('o1', [{ sku: 'A', qty: 5 * m }], 1); w.place('o2', [{ sku: 'A', qty: 1 * m }], 1); return w.snapshot(1); },
  R08: (W, m) => { const w = new W(); w.receive('L1', 'A', 6 * m, 99, 0); w.receive('L2', 'A', 6 * m, 120, 0); w.place('o1', [{ sku: 'A', qty: 8 * m }], 3); w.ship('o1', 'A', 8 * m); w.returnItems('o1', 'A', 3 * m, 4); return w.snapshot(4); },
};

const PUBLIC_TESTS = (m: number) => `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Warehouse } from '../src/warehouse.ts';

test('receive and place', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', ${10 * m}, 99, 0);
  assert.equal(w.place('o1', [{ sku: 'A', qty: ${3 * m} }], 1), 'reserved');
  assert.equal(w.snapshot(1).available.A, ${7 * m});
});

test('earliest expiry first', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', ${3 * m}, 40, 0);
  w.receive('L2', 'A', ${3 * m}, 30, 0);
  w.place('o1', [{ sku: 'A', qty: ${2 * m} }], 1);
  assert.deepEqual(w.snapshot(1).lots, [{ id: 'L1', qty: ${3 * m}, reserved: 0 }, { id: 'L2', qty: ${3 * m}, reserved: ${2 * m} }]);
});

test('ship and cancel', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', ${8 * m}, 99, 0);
  w.place('o1', [{ sku: 'A', qty: ${4 * m} }], 1);
  assert.equal(w.ship('o1', 'A', ${9 * m}), false);
  assert.equal(w.cancel('o1', 2), true);
  assert.equal(w.snapshot(2).available.A, ${8 * m});
});

test('backorder on a shortage and retry on receipt', () => {
  const w = new Warehouse();
  assert.equal(w.place('o1', [{ sku: 'A', qty: ${2 * m} }], 0), 'backordered');
  w.receive('L1', 'A', ${5 * m}, 99, 1);
  assert.equal(w.snapshot(1).orders[0].status, 'reserved');
});

test('return within what shipped', () => {
  const w = new Warehouse();
  w.receive('L1', 'A', ${8 * m}, 99, 0);
  w.place('o1', [{ sku: 'A', qty: ${4 * m} }], 1);
  w.ship('o1', 'A', ${4 * m});
  assert.equal(w.returnItems('o1', 'A', ${2 * m}, 2), true);
  assert.equal(w.returnItems('o1', 'A', ${9 * m}, 2), false);
});
`;

export async function writeLedgerTask(seed: number, out: string) {
  const inst = deriveLedger(seed);
  const id = out.split('/').pop()!;
  const w = (rel: string, body: string) => { const f = join(out, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); };
  const all = new Set(inst.defects);
  const bad = buildLedgerSrc(inst, new Set()), good = buildLedgerSrc(inst, all);
  for (const [f, b] of Object.entries(bad)) { w(`public/src/${f}`, b); w(`fixtures/broken/src/${f}`, b); }
  for (const [f, b] of Object.entries(good)) w(`fixtures/correct/src/${f}`, b);
  w('public/test/warehouse.test.ts', PUBLIC_TESTS(inst.m));
  w('public/SPEC.md', SPEC);
  w('public/brief.txt', BRIEF + '\n');
  const regression_ids = Object.keys(SCENARIOS).filter((k) => k.startsWith('R') || (k.startsWith('S') && !inst.defects.includes(k)));
  w('task.json', JSON.stringify({ task_id: id, build_suite: { defect_ids: inst.defects, regression_ids } }) + '\n');
  w('oracle/oracle.json', JSON.stringify({ kind: 'planted-defects' }) + '\n');
  w('oracle/instance.json', JSON.stringify({ seed, family: 'ledger', m: inst.m, defects: inst.defects }, null, 2) + '\n');
  w('oracle/DEFECTS.json', JSON.stringify(inst.defects.map((d) => ({ id: d, module: 'see DEFECT_MODULE', kind: LEDGER_KIND[d] })), null, 2) + '\n');
  const { Warehouse } = await import(pathToFileURL(resolve(out, 'fixtures/correct/src/warehouse.ts')).href + '?t=' + Math.random());
  const expected: Record<string, unknown> = {};
  for (const [k, fn] of Object.entries(SCENARIOS)) expected[k] = JSON.parse(JSON.stringify(fn(Warehouse, inst.m)));
  w('oracle/expected.json', JSON.stringify(expected, null, 2) + '\n');
  w('oracle/scenarios.ts', `export const SCENARIOS: Record<string, (W: any, m: number) => unknown> = {\n${Object.entries(SCENARIOS).map(([k, f]) => `  ${k}: ${f.toString()},`).join('\n')}\n};\n`);
  w('oracle/score.ts', LEDGER_SCORE);
  w('oracle/run.ts', LEDGER_RUN);
  w('README.md', `# ${id}\n\nGenerated by scripts/bench-build-ledger-gen.ts (seed ${seed}). Planted: ${inst.defects.join(', ')}. Only public/ reaches a seat.\n`);
  return inst;
}

const LEDGER_RUN = `/** Child of oracle/score.ts: runs every scenario against the workspace and prints the results as data. It never sees expected.json.
 * The result is written to fd 3 (a pipe score.ts owns), not stdout: stdout is shared with anything the workspace's own top-level
 * code prints, including a hook that races or preempts us, so it is never trusted. writeSyncFd3 and the fs module reference are
 * captured in a local closure BEFORE the workspace import runs, so a module that reassigns fs.writeSync afterward cannot change
 * what this file itself calls. If the workspace's own code exits the process before this file's own write runs, fd 3 stays
 * empty, which score.ts correctly reads as no result rather than a forged pass.
 */
import { writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIOS } from './scenarios.ts';

const writeSyncFd3 = writeSync;
const stringify = JSON.stringify.bind(JSON);
const [workspace, mText] = process.argv.slice(2);
const out: Record<string, { ok: boolean; value?: unknown }> = {};
let W: any = null;
try { W = (await import(pathToFileURL(resolve(workspace, 'src', 'warehouse.ts')).href)).Warehouse; } catch { W = null; }
for (const id of Object.keys(SCENARIOS)) {
  try { out[id] = W ? { ok: true, value: JSON.parse(stringify(SCENARIOS[id](W, Number(mText)))) } : { ok: false }; } catch { out[id] = { ok: false }; }
}
writeSyncFd3(3, stringify(out));
process.exit(0);
`;

const LEDGER_SCORE = `/** Private oracle for a generated ledger task. node --import tsx oracle/score.ts WORKSPACE
 * The workspace code runs only in a child process (oracle/run.ts) and is read back as plain data; this parent never imports it,
 * so a workspace cannot monkey-patch the comparison. A check passes when every key of the frozen expected value is deep-equal in the
 * result (extra fields and key order are ignored; the SPEC declares the snapshot shape frozen).
 * defect/<id>: scenario for a planted defect; regression/<id>: R* scenarios and the scenario of every catalogued defect that is NOT planted
 * in this instance (they hold in the original code, so reintroducing one of those defects is scored as shipped).
 *
 * Two layers against a workspace that tries to forge its own result (fable-review G1/G2; 6-astra-4's oracle-audit hardening):
 * (1) the child is launched under Node's --permission allowlist naming only run.ts, scenarios.ts and the workspace itself as
 * readable, with no inherited env and native TypeScript (no tsx, so no cwd-dependent loader resolution); it can never read
 * expected.json, so even a source-informed forger cannot produce the *correct* values, only guesses. Symlinks under the
 * workspace are rejected before launch. (2) the result itself still travels over a dedicated pipe (fd 3), not shared stdout,
 * written only by run.ts's own captured fs.writeSync reference; an empty or malformed fd 3 is refused outright.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
function readSingleResult(fd3: string | null | undefined): unknown {
  if (!fd3) return null;
  try { return JSON.parse(fd3); } catch { return null; }
}
function rejectSymlinks(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('oracle infrastructure: workspace symlink is forbidden');
  if (stat.isDirectory()) for (const name of readdirSync(path)) rejectSymlinks(join(path, name));
}

const workspace = process.argv[2];
if (!workspace) { console.error('usage: score.ts WORKSPACE'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8'));
const runner = realpathSync(join(here, 'run.ts'));
const scenarios = realpathSync(join(here, 'scenarios.ts'));
let candidate: string;
try {
  const resolved = resolve(workspace);
  if (lstatSync(resolved).isSymbolicLink()) throw new Error('oracle infrastructure: workspace symlink is forbidden');
  candidate = realpathSync(resolved);
  rejectSymlinks(candidate);
} catch (error) { console.error('oracle infrastructure: ' + String(error)); process.exit(3); }
const child = spawnSync(process.execPath, [
  '--permission', '--allow-fs-read=' + runner, '--allow-fs-read=' + scenarios, '--allow-fs-read=' + candidate,
  runner, candidate, String(inst.m),
], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, env: {}, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
const fd3 = child.output?.[3] as string | null;
const parsedFd3 = readSingleResult(fd3);
if (parsedFd3 === null || typeof parsedFd3 !== 'object' || Array.isArray(parsedFd3)) {
  // A legitimate run (correct, broken or adversarial candidate) always writes a well-formed JSON object to fd 3:
  // run.ts's own import is wrapped so even a candidate that fails to import still produces an all-false result
  // before exiting. Fd 3 being empty, unparseable or not an object is either tamper -- a permission wall the
  // sandboxed child hit while attempting something forbidden (ERR_ACCESS_DENIED/EACCES), a clean early exit(0)
  // that never let run.ts's own write happen, or a forged/garbage write -- or, only when none of those signatures
  // is present, our own scorer/harness genuinely broke (infrastructure).
  const stderr = (child.stderr ?? '').trim();
  const isTamper = child.status === 0 || /ERR_ACCESS_DENIED|EACCES/.test(stderr) || (!!fd3 && parsedFd3 === null);
  console.error((isTamper ? 'oracle infrastructure: tamper (' : 'oracle infrastructure: worker produced no result (') + stderr + ')');
  process.exit(isTamper ? 3 : 2);
}
let got: Record<string, { ok: boolean; value?: unknown }> = parsedFd3 as typeof got;
function subset(exp: unknown, act: unknown): boolean {
  if (Array.isArray(exp)) return Array.isArray(act) && act.length === exp.length && exp.every((e, i) => subset(e, act[i]));
  if (exp && typeof exp === 'object') return !!act && typeof act === 'object' && !Array.isArray(act) && Object.entries(exp).every(([k, v]) => subset(v, (act as any)[k]));
  return Object.is(exp, act);
}
const run = (id: string) => !!got[id]?.ok && subset(expected[id], got[id].value);
const oracle_results: { name: string; exit_code: number }[] = [];
const caught_ids: string[] = [], missed_ids: string[] = [], regression_failed_ids: string[] = [];
for (const id of inst.defects) { const ok = run(id); oracle_results.push({ name: 'defect/' + id, exit_code: ok ? 0 : 1 }); (ok ? caught_ids : missed_ids).push(id); }
for (const id of Object.keys(expected).filter((k) => k.startsWith('R') || (k.startsWith('S') && !inst.defects.includes(k)))) { const ok = run(id); oracle_results.push({ name: 'regression/' + id, exit_code: ok ? 0 : 1 }); if (!ok) regression_failed_ids.push(id); }
const score = missed_ids.length === 0 && regression_failed_ids.length === 0 ? 1 : 0;
console.log(JSON.stringify({ score, oracle_results, defects_planted: inst.defects.length, defects_caught: caught_ids.length, defects_shipped: missed_ids.length + regression_failed_ids.length, regressions_failed: regression_failed_ids.length, caught_ids, missed_ids, regression_failed_ids }));
process.exit(score === 1 ? 0 : 1);
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const seed = Number(process.argv[2]);
  if (!Number.isInteger(seed)) { console.error('usage: bench-build-ledger-gen.ts <seed> [--out dir]'); process.exit(2); }
  const oi = process.argv.indexOf('--out');
  writeLedgerTask(seed, resolve(oi > 0 ? process.argv[oi + 1] : `tasks/build-ledger-s${seed}`)).then((i) => console.log(i.defects.join(' ')));
}
