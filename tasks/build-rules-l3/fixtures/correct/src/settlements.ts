export function onsiteLimit(x: number): number {
  return Math.min(520, Math.max(20, x));
}

export function priorityLimit(x: number): number {
  return Math.min(350, Math.max(90, x));
}

export function seasonalValid(day: number): boolean {
  return day >= 181 && day < 220;
}

export function insuranceFree(units: number): number {
  return Math.min(units, 4) * 175;
}
