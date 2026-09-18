export type LineItem = { qty: number; unitPrice: number };

export function computeSubtotal(items: LineItem[]): number {
  let total = 0;
  for (const item of items) {
    if (item.qty < 0) throw new Error('invalid quantity');
    total += item.qty * item.unitPrice;
  }
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

export function computeInvoiceTotal(items: LineItem[], taxRate: number): number {
  let total = 0;
  for (const item of items) {
    if (item.qty < 0) throw new Error('invalid quantity');
    total += item.qty * item.unitPrice;
  }
  const subtotal = Math.round((total + Number.EPSILON) * 100) / 100;
  const tax = Math.round((subtotal * taxRate + Number.EPSILON) * 100) / 100;
  return Math.round((subtotal + tax + Number.EPSILON) * 100) / 100;
}
