export function licenseBand(x: number): number {
  return x < 10 ? 450 : x < 30 ? 600 : 1200;
}

export function depositLimit(x: number): number {
  return Math.min(380, Math.max(20, x));
}

export function archiveBand(x: number): number {
  return x < 27 ? 400 : x < 107 ? 550 : 850;
}
