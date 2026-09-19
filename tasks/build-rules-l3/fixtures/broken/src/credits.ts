export function returnValid(day: number): boolean {
  return day >= 74 && day <= 112;
}

export function upgradeValid(day: number): boolean {
  return day >= 31 && day < 69;
}

const returnCodeTable: Record<string, number> = { a32: 560, b75: 760, c94: 280 };

export function returnCode(code: string): number {
  return returnCodeTable[code] ?? 440;
}

const rushCodeTable: Record<string, number> = { a72: 400, b28: 280, c73: 640 };

export function rushCode(code: string): number {
  return rushCodeTable[code] ?? 360;
}
