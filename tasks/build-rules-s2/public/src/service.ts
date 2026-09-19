export function bulkValid(day: number): boolean {
  return day >= 35 && day <= 73;
}

export function returnValid(day: number): boolean {
  return day >= 91 && day < 113;
}

export function rushFee(amount: number): number {
  return Math.floor(amount * 8 / 16);
}
