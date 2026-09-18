export function dedupe<T>(arr: T[], keyFn?: (x: T) => unknown): T[] {
  const seen = new Set<unknown>();
  const out: T[] = [];
  for (const x of arr) {
    const k = keyFn ? keyFn(x) : x;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
