export function dedupe<T>(arr: T[], keyFn?: (x: T) => unknown): T[] {
  const seen = new Set<unknown>();
  const out: T[] = [];
  for (const x of arr) {
    const key = keyFn ? keyFn(x) : x;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}
