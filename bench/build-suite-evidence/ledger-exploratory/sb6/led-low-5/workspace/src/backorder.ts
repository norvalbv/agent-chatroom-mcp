import type { Inventory } from './inventory.ts';
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
    const ids = [...this.queue];
    for (const id of ids) {
      const order = orders.get(id)!;
      
      if (tryReserve(inv, order, day)) this.remove(id);
    }
  }
}

function size(o: Order): number {
  return o.lines.reduce((a, l) => a + l.qty, 0);
}
