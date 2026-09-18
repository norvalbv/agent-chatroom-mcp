// Builds oracle/cases.json from ICU's Hebrew calendar, keeping only dates where ICU and the reference agree,
// away from the four Hebrew years where ICU and the classical arithmetic disagree (see ADMISSION.md).
// usage: node --import tsx oracle/gen-cases.ts   (rewrites oracle/cases.json)
import { writeFileSync } from 'node:fs';
import { toHebrew } from '../fixtures/correct/hebrew.ts';

const f = new Intl.DateTimeFormat('en-u-ca-hebrew-nu-latn', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const leap = (y: number) => [0, 3, 6, 8, 11, 14, 17].includes(y % 19);
const common = ['Tishri', 'Heshvan', 'Kislev', 'Tevet', 'Shevat', 'Adar', 'Nisan', 'Iyar', 'Sivan', 'Tamuz', 'Av', 'Elul'];
const leapNames = ['Tishri', 'Heshvan', 'Kislev', 'Tevet', 'Shevat', 'Adar I', 'Adar II', 'Nisan', 'Iyar', 'Sivan', 'Tamuz', 'Av', 'Elul'];
type H = { year: number; month: number; day: number };
const icu = (t: number): H => {
  const parts = f.formatToParts(new Date(t));
  const g = (k: string) => parts.find((p) => p.type === k)!.value;
  const year = Number(g('year'));
  return { year, month: (leap(year) ? leapNames : common).indexOf(g('month')) + 1, day: Number(g('day')) };
};

const start = Date.UTC(1583, 0, 1), end = Date.UTC(2600, 11, 31);
const days: { t: number; h: H }[] = [];
const disagree = new Set<number>();
for (let t = start; t <= end; t += 86400000) {
  const h = icu(t);
  const d = new Date(t);
  const r = toHebrew(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  if (r.year !== h.year || r.month !== h.month || r.day !== h.day) { disagree.add(h.year); disagree.add(r.year); }
  days.push({ t, h });
}
const excluded = new Set<number>();
for (const y of disagree) { excluded.add(y - 1); excluded.add(y); excluded.add(y + 1); }

// per Hebrew year: first day index, length, and which postponement decides its start
const byYear = new Map<number, { first: number; last: number }>();
days.forEach((x, i) => { const e = byYear.get(x.h.year); if (!e) byYear.set(x.h.year, { first: i, last: i }); else e.last = i; });
const years = [...byYear.keys()].filter((y) => byYear.get(y)!.first > 0 && !excluded.has(y) && byYear.has(y + 1) && byYear.get(y + 1)!.last < days.length - 1);

const PARTS = 25920, LUN = 765433;
const monthsBefore = (y: number) => { let m = 0; for (let i = 1; i < y; i++) m += leap(i % 19) ? 13 : 12; return m; };
const wd = (d: number) => ((d % 7) + 7) % 7;
const cls = (y: number) => {
  const total = 57444 + LUN * monthsBefore(y); const q = Math.floor(total / PARTS); const r = total - q * PARTS;
  const tags: string[] = [];
  if (r >= 19440) tags.push('zaken');
  else if (wd(q) === 3 && r >= 9924 && !leap(y % 19)) tags.push('gatarad');
  else if (wd(q) === 2 && r >= 16789 && leap((y - 1) % 19)) tags.push('betutekapot');
  return tags;
};
const len = (y: number) => byYear.get(y)!.last - byYear.get(y)!.first + 1;

const chosen = new Set<number>();
const want = (pred: (y: number) => boolean, n: number) => { let c = 0; for (const y of years) if (pred(y) && !chosen.has(y) && c < n && y % 3 !== 0) { chosen.add(y); c++; } };
for (const L of [353, 354, 355, 383, 384, 385]) want((y) => len(y) === L, 4);
for (const tag of ['zaken', 'gatarad', 'betutekapot']) want((y) => cls(y).includes(tag), 4);
want((y) => len(y) === 355 && len(y - 1) !== undefined, 0);
// years whose length was changed by the 356/382 delay rule (provisional gap 356 or 382)
const provisionalGap = (y: number) => {
  const p = (yy: number) => { const total = 57444 + LUN * monthsBefore(yy); const q = Math.floor(total / PARTS); const r = total - q * PARTS; let d = q;
    if (r >= 19440) d += 1; else if (wd(q) === 3 && r >= 9924 && !leap(yy % 19)) d += 1; else if (wd(q) === 2 && r >= 16789 && leap((yy - 1) % 19)) d += 1;
    if ([1, 4, 6].includes(wd(d))) d += 1; return d; };
  return { next: p(y + 1) - p(y), prev: p(y) - p(y - 1) };
};
want((y) => provisionalGap(y).next === 356, 4);
want((y) => provisionalGap(y).prev === 382, 4);
want((y) => true, 40 - chosen.size);

const cases: { g: [number, number, number]; h: [number, number, number] }[] = [];
const seen = new Set<number>();
const add = (i: number) => {
  if (i < 0 || i >= days.length || seen.has(i)) return;
  seen.add(i);
  const d = new Date(days[i].t); const h = days[i].h;
  cases.push({ g: [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()], h: [h.year, h.month, h.day] });
};
for (const y of [...chosen].sort((a, b) => a - b)) {
  const { first, last } = byYear.get(y)!;
  add(first - 1); add(first); add(first + 1); add(last); add(last + 1);
  let prevMonth = 1;
  for (let i = first; i <= last; i++) {
    if (days[i].h.month !== prevMonth) { add(i - 1); add(i); prevMonth = days[i].h.month; }
  }
  add(first + 29); add(first + 59);
}
cases.sort((a, b) => a.g[0] - b.g[0] || a.g[1] - b.g[1] || a.g[2] - b.g[2]);
writeFileSync(new URL('./cases.json', import.meta.url), JSON.stringify({ excluded_hebrew_years: [...excluded].sort((a, b) => a - b), chosen_years: [...chosen].sort((a, b) => a - b), cases }));
console.log('chosen years', chosen.size, 'cases', cases.length, 'excluded', [...excluded].sort((a, b) => a - b).join(','));
