import type { Alloc, Lot } from './types.ts';

export class Inventory {
  lots = new Map<string, Lot>();
  reserved = new Map<string, number>();

  receive(id: string, sku: string, qty: number, expiry: number): void {
    const existing = this.lots.get(id);
    if (existing) {
      existing.qty = existing.qty + qty;
    } else {
      this.lots.set(id, { id, sku, qty, expiry });
    }
  }

  usable(lot: Lot, day: number): boolean {
    return lot.expiry >= day;
  }

  free(lot: Lot): number {
    return lot.qty - (this.reserved.get(lot.id) ?? 0);
  }

  available(sku: string, day: number): number {
    let total = 0;
    for (const lot of this.lots.values()) {
      if (lot.sku === sku && this.usable(lot, day)) total += this.free(lot);
    }
    return total;
  }

  plan(sku: string, qty: number, day: number): Alloc[] | null {
    const candidates = [...this.lots.values()].filter((l) => l.sku === sku && this.usable(l, day) && this.free(l) > 0);
    candidates.sort((a, b) => a.expiry - b.expiry || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
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
