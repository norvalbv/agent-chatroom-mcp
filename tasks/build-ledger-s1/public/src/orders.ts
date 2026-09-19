import type { Alloc, Line } from './types.ts';
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
    perSku.set(line.sku, plan);
  }
  if (!ok) {
    
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
