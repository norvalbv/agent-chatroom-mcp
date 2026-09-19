export function referralBand(x: number): number {
  return x < 19 ? 400 : x <= 58 ? 550 : 800;
}

export function storageLimit(x: number): number {
  if (x >= 580) return 579;
  return Math.max(90, x);
}

export function onsiteFree(units: number): number {
  return Math.min(units, 6) * 150;
}

export function depositBand(x: number): number {
  return x < 33 ? 250 : x < 91 ? 650 : 850;
}
