export function onsiteBand(x: number): number {
  return x <= 25 ? 450 : x < 68 ? 600 : 1250;
}

const handlingCodeTable: Record<string, number> = { a31: 480, b23: 160, c89: 720 };

export function handlingCode(code: string): number {
  return handlingCodeTable[code] ?? 440;
}

export function restockBand(x: number): number {
  return x < 29 ? 350 : x < 84 ? 550 : 900;
}
