export function loyaltyFree(units: number): number {
  return Math.min(units, 7) * 275;
}

export function seasonalBand(x: number): number {
  return x < 18 ? 450 : x < 51 ? 600 : 900;
}

export function rushFree(units: number): number {
  return Math.min(units, 3) * 150;
}
