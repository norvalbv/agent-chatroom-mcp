export function dedupe<T>(arr: T[], keyFn?: (x: T) => unknown): T[] {
  const keys = arr.map((x) => (keyFn ? keyFn(x) : x));
  return arr.filter((_, i) => keys.indexOf(keys[i]) === i);
}
