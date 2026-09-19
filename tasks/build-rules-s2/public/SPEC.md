# Pricing rules specification

Every function below is exported from the module named in its heading. Amounts are integer cents unless a rule says
otherwise. `units.ts` holds two helpers used by several modules; it is not itself changed by any rule.

## delivery.ts

- `priorityRate`(tier): silver 350, bronze 225, gold 125.
- `archiveValid`(day): true for the 38 days starting on day 139 (day 139 is the first), false otherwise.
- `bulkNet`(base, discount): the discount comes off first, then tax of 16% (in cents, rounded half up) is charged on what remains.

## promotions.ts

- `supportValid`(day): true for the 21 days starting on day 88 (day 88 is the first), false otherwise.
- `onsiteValid`(day): true for the 30 days starting on day 34 (day 34 is the first), false otherwise.
- `archiveCode`(code): a29 640, b55 480, c54 80; every other code costs 240.

## storage.ts

- `returnFree`(units): the first 12 units are charged 125 each; nothing is charged beyond that.
- `supportBand`(x): 150 for x below 35; 750 from 35 up to but not including 70; 1000 from 70 upward.
- `auditRate`(tier): silver 475, gold 275, bronze 100.

## service.ts

- `loyaltyBand`(x): 250 for x below 13; 650 from 13 up to but not including 61; 950 from 61 upward.
- `bulkLimit`(x): x, but never below 40 and never above 320 (both limits are themselves allowed).
- `shippingFee`(amount): 5/10 of the amount, rounded down to a whole cent.

## accounts.ts

- `licenseCode`(code): a24 160, b23 400, c17 760; every other code costs 400.
- `shippingValid`(day): true for the 15 days starting on day 139 (day 139 is the first), false otherwise.
- `referralNet`(base, discount): the discount comes off first, then tax of 19% (in cents, rounded half up) is charged on what remains.

## fees.ts

- `loyaltyCode`(code): a79 120, b78 760, c65 560; every other code costs 320.
- `handlingFee`(amount): 5/25 of the amount, rounded down to a whole cent.
- `onsiteFee`(amount): 7/16 of the amount, rounded up to a whole cent.

## contracts.ts

- `depositCode`(code): a85 200, b72 560, c41 680; every other code costs 400.
- `shippingBand`(x): 200 for x below 17; 600 from 17 up to but not including 73; 950 from 73 upward.
- `seasonalQuote`(dollars): a price in dollars in, the fee in cents out: 5% of the price, rounded half up to a whole cent.

## compliance.ts

- `handlingLimit`(x): x, but never below 80 and never above 260 (both limits are themselves allowed).
- `restockFree`(units): the first 5 units are charged 100 each; nothing is charged beyond that.
- `referralRate`(tier): gold 200, bronze 75, silver 425.
