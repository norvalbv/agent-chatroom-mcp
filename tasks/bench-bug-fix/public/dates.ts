export function inclusiveDates(start: string, end: string): string[] {
  if (typeof start !== 'string' || typeof end !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('invalid date range');
  }
  const s = Date.parse(start + 'T00:00:00Z');
  const e = Date.parse(end + 'T00:00:00Z');
  if (!Number.isFinite(s) || !Number.isFinite(e) ||
      new Date(s).toISOString().slice(0, 10) !== start ||
      new Date(e).toISOString().slice(0, 10) !== end || s > e) {
    throw new Error('invalid date range');
  }
  const out: string[] = [];
  for (let t = s; t < e; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
