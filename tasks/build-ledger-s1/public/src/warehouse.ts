import type { Line } from './types.ts';
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
    if (qty <= 0 || qty > (order.lines.find((l) => l.sku === sku)?.qty ?? 0)) return false;
    let need = qty;
    const shipped = order.shipped.get(sku) ?? [];
    for (const a of remaining) {
      if (need <= 0) break;
      const take = Math.min(need, a.qty);
      this.inv.consume({ lotId: a.lotId, qty: take });
      a.qty -= take;
      shipped.push({ lotId: a.lotId, qty: take });
      need -= take;
    }
    order.remaining.set(sku, remaining.filter((a) => a.qty > 0));
    order.shipped.set(sku, shipped);
    return true;
  }

  cancel(id: string, day: number): boolean {
    const order = this.orders.get(id);
    if (!order || order.status === 'cancelled') return false;
    if (order.status === 'reserved') {
      for (const allocs of order.remaining.values()) this.inv.unhold(allocs);
      for (const allocs of order.shipped.values()) this.inv.unhold(allocs);
    }
    order.status = 'cancelled';
    
    
    return true;
  }

  returnItems(id: string, sku: string, qty: number, day: number): boolean {
    const order = this.orders.get(id);
    if (!order) return false;
    const shippedQty = total(order.shipped.get(sku));
    const already = order.returned.get(sku) ?? 0;
    if (qty <= 0 || qty > shippedQty - already) return false;
    order.returned.set(sku, already + qty);
    let left = qty;
    for (const a of [...(order.shipped.get(sku) ?? [])].reverse()) {
      if (left <= 0) break;
      const take = Math.min(left, a.qty);
      const lot = this.inv.lots.get(a.lotId)!;
      if (this.inv.usable(lot, day)) lot.qty += take;
      left -= take;
    }
    this.backorders.retry(this.inv, this.orders, day);
    return true;
  }

  snapshot(day: number) {
    const skus = [...new Set([...this.inv.lots.values()].map((l) => l.sku))].sort();
    return {
      lots: [...this.inv.lots.values()].map((l) => ({ id: l.id, qty: l.qty, reserved: this.inv.reserved.get(l.id) ?? 0 })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      orders: [...this.orders.values()].map((o) => ({ id: o.id, status: o.status, remaining: Object.fromEntries([...o.remaining].map(([k, v]) => [k, total(v)])), shipped: Object.fromEntries([...o.shipped].map(([k, v]) => [k, total(v)])) })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      backorders: [...this.backorders.queue],
      available: Object.fromEntries(skus.map((s) => [s, this.inv.available(s, day)])),
    };
  }
}
