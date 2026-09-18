const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseUtcDate(value: string): number {
  const m = typeof value === 'string' ? value.match(DATE_RE) : null;
  if (!m) throw new Error('invalid date range');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new Error('invalid date range');
  }
  return ms;
}

export function inclusiveDates(start: string, end: string): string[] {
  const s = parseUtcDate(start);
  const e = parseUtcDate(end);
  if (s > e) throw new Error('invalid date range');

  const out: string[] = [];
  for (let t = s; t <= e; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
