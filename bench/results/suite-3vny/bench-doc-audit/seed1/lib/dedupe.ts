export function dedupe<T>(arr: T[], keyFn?: (x: T) => unknown): T[] {
  const seen = new Set<unknown>();
  return arr.filter((x) => {
    const key = keyFn ? keyFn(x) : x;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
