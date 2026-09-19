export function roundHalfUp(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function fmt(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return sign + (abs / 100).toFixed(2);
}
