const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new RangeError('invalid byte count');
  if (n < 1024) return `${Math.round(n)} B`;
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  let text = value.toFixed(1);
  if (text === '1024.0' && unit < UNITS.length - 1) {
    text = '1.0';
    unit++;
  }
  return `${text.endsWith('.0') ? text.slice(0, -2) : text} ${UNITS[unit]}`;
}
