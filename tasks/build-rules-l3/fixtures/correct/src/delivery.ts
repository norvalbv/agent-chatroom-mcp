export function referralValid(day: number): boolean {
  return day >= 10 && day < 33;
}

export function insuranceLimit(x: number): number {
  return Math.min(350, Math.max(50, x));
}

export function setupFee(amount: number): number {
  return Math.round(amount * 8 / 13);
}

export function shippingLimit(x: number): number {
  return Math.min(500, Math.max(30, x));
}
