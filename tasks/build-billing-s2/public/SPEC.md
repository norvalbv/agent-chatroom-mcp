# Billing library specification

All money is integer cents. Dates are calendar days (`Ymd`); a period or subscription end date is the first day
that is NOT covered.

## money
- `roundHalfUp(x)` rounds to the nearest integer; exact halves round away from zero, for negative numbers too
  (-2.5 becomes -3, 2.5 becomes 3).

## calendar
- `addMonths(d, n)` keeps the day of month; if the target month is shorter, it uses that month's last day
  (31 Jan plus one month is 28 Feb, or 29 Feb in a leap year). It never spills into the following month.
- `daysBetween(a, b)` is b minus a in calendar days.

## plans
- Usage is graduated. The first 200 units of a starter subscription cost 20 cents each, units 201 to 500 cost 9 cents each,
  and further units cost 7 cents each. Each unit is charged at the price of the tier it falls in, once.
  (The growth plan has its own price table in `plans.ts` and follows the same rule.)

## proration
- `remainingShare(start, end, from)` is the number of days from `from` to `end` divided by the actual number of days in
  the period from `start` to `end`, whatever its length.
- `prorate` charges that share of an amount; `prorateCredit` returns the same amount as a negative credit. Both round with `roundHalfUp`.

## coupons
- Percent coupons (value in basis points) are added together and taken from the original subtotal; they are applied
  before fixed coupons whatever order they are listed in. A percent coupon's discount may not exceed its `maxCents` when it has one.
- Fixed coupons subtract their value in cents.
- The total discount never exceeds the subtotal, so an invoice total before tax is never negative.

## tax
- Region X is taxed at 700 basis points, Z at 500, others at 0. Tax is on the amount after discount and is rounded once per invoice with `roundHalfUp`.
- A customer with `taxExempt: true` is charged no tax.

## invoice
- An invoice has a base line and a usage line. The subtotal is their sum. Discount, tax and total follow the rules above:
  total = subtotal - discount + tax.

## dunning
- No late fee is charged while an invoice is at most 7 days past its due date. From the day after that, the fee is
  2% of the invoice (`roundHalfUp`), capped at 3000 cents.

## report
- A subscription is active on `asOf` from its start day up to but not including its end day; with no end it stays active.
- Monthly recurring revenue (MRR) is the sum of the monthly value of the active subscriptions. An annual subscription's monthly
  value is its annual amount divided by 12, rounded with `roundHalfUp`.
