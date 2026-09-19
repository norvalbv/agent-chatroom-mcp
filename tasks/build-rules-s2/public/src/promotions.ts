export function supportValid(day: number): boolean {
  return day >= 88 && day < 109;
}

export function onsiteValid(day: number): boolean {
  return day >= 34 && day <= 64;
}

const archiveCodeTable: Record<string, number> = { a29: 640, b55: 480, c54: 80 };

export function archiveCode(code: string): number {
  return archiveCodeTable[code] ?? 240;
}
