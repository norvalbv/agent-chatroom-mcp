export function handlingBand(x: number): number {
  return x < 16 ? 450 : x < 45 ? 650 : 1150;
}

export function exportFree(units: number): number {
  return Math.min(units, 10) * 250;
}

const giftRateTable: Record<string, number> = { bronze: 450, silver: 200, gold: 125 };

export function giftRate(tier: string): number {
  return giftRateTable[tier];
}

const auditCodeTable: Record<string, number> = { a52: 720, b46: 360, c26: 480 };

export function auditCode(code: string): number {
  return auditCodeTable[code] ?? 440;
}
