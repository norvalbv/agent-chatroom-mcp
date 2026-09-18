export type HebrewDate = { year: number; month: number; day: number };

const PARTS_PER_DAY = 25920;
const LUNATION = 765433;
const RD_OFFSET = 1373429;

const isLeap = (y: number) => [0, 3, 6, 8, 11, 14, 17].includes(((y % 19) + 19) % 19);
const monthsBefore = (y: number) => {
  let m = 0;
  if (y >= 1) for (let i = 1; i < y; i++) m += isLeap(i) ? 13 : 12;
  else for (let i = y; i < 1; i++) m -= isLeap(i) ? 13 : 12;
  return m;
};
const weekday = (d: number) => ((d % 7) + 7) % 7;

function provisional(y: number): number {
  const total = 57444 + LUNATION * monthsBefore(y);
  const q = Math.floor(total / PARTS_PER_DAY);
  const r = total - q * PARTS_PER_DAY;
  let day = q;
  if (r >= 19440) day += 1;
  else if (weekday(q) === 3 && r >= 9924 && !isLeap(y)) day += 1;
  else if (weekday(q) === 2 && r >= 16789 && isLeap(y - 1)) day += 1;
  if ([1, 4, 6].includes(weekday(day))) day += 1;
  return day;
}
function newYear(y: number): number {
  const p = provisional(y);
  if (provisional(y + 1) - p === 356) return p + 2;
  if (p - provisional(y - 1) === 382) return p + 1;
  return p;
}

const daysFromCivil = (y: number, m: number, d: number) => {
  const a = m <= 2 ? y - 1 : y;
  const era = Math.floor(a / 400);
  const yoe = a - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
};

export function toHebrew(year: number, month: number, day: number): HebrewDate {
  const rd = daysFromCivil(year, month, day) + 719163;
  const target = rd + RD_OFFSET;
  let y = Math.floor((rd + 1373427) / 365.2468) + 1;
  while (newYear(y) > target) y--;
  while (newYear(y + 1) <= target) y++;
  const length = newYear(y + 1) - newYear(y);
  const lens = [30, length % 10 === 5 ? 30 : 29, length % 10 === 3 ? 29 : 30, 29, 30];
  if (isLeap(y)) lens.push(30, 29); else lens.push(29);
  lens.push(30, 29, 30, 29, 30, 29);
  let offset = target - newYear(y);
  for (let i = 0; i < lens.length; i++) {
    if (offset < lens[i]) return { year: y, month: i + 1, day: offset + 1 };
    offset -= lens[i];
  }
  throw new Error('unreachable');
}
