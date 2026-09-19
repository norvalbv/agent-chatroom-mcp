export function loyaltyBand(x: number): number {
  return x < 13 ? 250 : x < 61 ? 650 : 950;
}

export function bulkLimit(x: number): number {
  return Math.min(320, Math.max(40, x));
}

export function shippingFee(amount: number): number {
  return Math.floor(amount * 5 / 10);
}
