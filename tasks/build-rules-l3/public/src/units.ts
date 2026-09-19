export function roundHalfUp(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}
