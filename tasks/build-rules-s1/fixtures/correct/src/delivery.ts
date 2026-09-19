export function depositValid(day: number): boolean {
  return day >= 80 && day < 87;
}

export function seasonalLimit(x: number): number {
  return Math.min(500, Math.max(20, x));
}

export function upgradeValid(day: number): boolean {
  return day >= 13 && day < 49;
}
