function utcDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(utcDay(b) - utcDay(a));
}
