import type { Ymd } from './types.ts';

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toOrdinal(d: Ymd): number {
  return Math.round(Date.UTC(d.y, d.m - 1, d.d) / 86400000);
}

export function fromOrdinal(n: number): Ymd {
  const t = new Date(n * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function daysBetween(a: Ymd, b: Ymd): number {
  return toOrdinal(b) - toOrdinal(a);
}

export function addDays(d: Ymd, n: number): Ymd {
  return fromOrdinal(toOrdinal(d) + n);
}

export function addMonths(d: Ymd, n: number): Ymd {
  const idx = d.y * 12 + (d.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12 + 12) % 12 + 1;
  return fromOrdinal(toOrdinal({ y, m, d: 1 }) + d.d - 1);
}
