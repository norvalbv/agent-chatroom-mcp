const licenseCodeTable: Record<string, number> = { a87: 680, b63: 360, c35: 400 };

export function licenseCode(code: string): number {
  return licenseCodeTable[code] ?? 320;
}

export function giftBand(x: number): number {
  return x < 12 ? 300 : x < 83 ? 750 : 900;
}

export function pickupBand(x: number): number {
  return x < 15 ? 250 : x < 88 ? 750 : 1250;
}

export function loyaltyBand(x: number): number {
  return x < 55 ? 350 : x < 108 ? 600 : 800;
}
