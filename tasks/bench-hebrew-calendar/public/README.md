# Gregorian to Hebrew date conversion

Implement `toHebrew(year, month, day)` in `hebrew.ts`. The arguments are a proleptic Gregorian date
(1583 <= year <= 2600, month 1-12). Return `{ year, month, day }`: the same calendar day in the fixed,
arithmetical Hebrew calendar described below. The Hebrew `month` is the position of the month in its
year, counting Tishri as 1 (so a leap year has months 1 to 13).

The calendar is defined entirely by the rules below. Do not use `Intl`, any calendar or date-formatting
library, or any external tool to do the conversion.

## Day numbers

Days are counted with R.D. numbers: R.D. 1 is 1 January 0001 (proleptic Gregorian), and R.D. 719163 is
1 January 1970. The Hebrew year `y` begins on 1 Tishri.

## Leap years and months elapsed

A Hebrew year `y` is a leap year when `y mod 19` is one of 0, 3, 6, 8, 11, 14, 17; it then has 13 months,
otherwise 12. Let `M(y)` be the total number of months in years 1, 2, ..., y-1 (so `M(1) = 0`; the formula
must also work for `y = 0`, where `M(0)` is minus the months of year 0, and for the years next to it).

## The molad and its postponements

One lunar month is exactly 29 days 12 hours 793 parts, with 1 hour = 1080 parts and 1 day = 24 hours =
25920 parts. Time is reckoned in the traditional Jewish day, which begins at 6 pm the evening before its
civil date, so a clock reading of 0 hours is 6 pm. The mean conjunction (molad) of Tishri of year 1 falls
on day 2, 5 hours, 204 parts, where day 1 is a Sunday, day 2 a Monday, and so on with day 7 a Saturday, and
day 8 a Sunday again; the molad of Tishri of year `y` falls `M(y)` lunar months later. Express it as a
day number `q` (weekday from `q mod 7`: 1 Sunday, 2 Monday, 3 Tuesday, 4 Wednesday, 5 Thursday,
6 Friday, 0 Saturday) and a clock time `r` in parts since the start of that day.

The provisional New Year day `P(y)` is found from `q`, `r` and the weekday, in this order:

1. If `r` is 18 hours (19440 parts) or more (molad zaken), the day is `q + 1`.
2. Otherwise, if `q` is a Tuesday, `r` is 9 hours 204 parts (9924 parts) or more, and year `y` is not a
   leap year, the day is `q + 1` (GaTaRaD).
3. Otherwise, if `q` is a Monday, `r` is 15 hours 589 parts (16789 parts) or more, and year `y - 1` is a
   leap year, the day is `q + 1` (BeTU'TeKaPoT).
4. Otherwise the day is `q`.

Then, if the day found is a Sunday, Wednesday or Friday, `P(y)` is that day plus 1 (Lo ADU Rosh);
otherwise `P(y)` is the day found.

The day number scale used here is the one where `P(1) = 2` is R.D. -1373427. So `P(y)` corresponds to
R.D. number `P(y) - 1373429`.

## Year lengths and the actual New Year

A year may not have 356 days after `P` alone, nor may a leap year have 382. The actual New Year `N(y)` is:

- `P(y) + 2` if `P(y+1) - P(y)` is 356;
- otherwise `P(y) + 1` if `P(y) - P(y-1)` is 382;
- otherwise `P(y)`.

The length of year `y` is `N(y+1) - N(y)` days. It is one of 353, 354, 355 (common year) or 383, 384, 385
(leap year).

## Months

In order, starting from Tishri (month 1), the months of year `y` have these lengths:

| Month | Days |
|---|---|
| Tishri | 30 |
| Heshvan | 30 if the year length ends in 5 (355 or 385), otherwise 29 |
| Kislev | 29 if the year length ends in 3 (353 or 383), otherwise 30 |
| Tevet | 29 |
| Shevat | 30 |
| Adar I (leap years only) | 30 |
| Adar (common years) or Adar II (leap years) | 29 |
| Nisan | 30 |
| Iyar | 29 |
| Sivan | 30 |
| Tamuz | 29 |
| Av | 30 |
| Elul | 29 |

A day's Hebrew `day` is its 1-based position within its month.
