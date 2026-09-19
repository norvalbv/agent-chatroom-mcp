# Pricing rules specification

Every function below is exported from the module named in its heading. Amounts are integer cents unless a rule says
otherwise. `units.ts` holds two helpers used by several modules; it is not itself changed by any rule.

## delivery.ts

- `depositLimit`(x): x, but never below 70 and never above 200 (both limits are themselves allowed).
- `archiveValid`(day): true for the 26 days starting on day 142 (day 142 is the first), false otherwise.
- `storageQuote`(dollars): a price in dollars in, the fee in cents out: 11% of the price, rounded half up to a whole cent.

## promotions.ts

- `onsiteBand`(x): 450 for x below 25; 600 from 25 up to but not including 68; 1250 from 68 upward.
- `handlingCode`(code): a31 480, b23 160, c89 720; every other code costs 440.
- `restockBand`(x): 350 for x below 29; 550 from 29 up to but not including 84; 900 from 84 upward.

## storage.ts

- `priorityRate`(tier): bronze 75, gold 425, silver 275.
- `referralFee`(amount): 7/13 of the amount, rounded up to a whole cent.
- `giftRate`(tier): bronze 350, silver 275, gold 100.

## service.ts

- `bulkValid`(day): true for the 38 days starting on day 35 (day 35 is the first), false otherwise.
- `returnValid`(day): true for the 22 days starting on day 91 (day 91 is the first), false otherwise.
- `rushFee`(amount): 8/16 of the amount, rounded up to a whole cent.

## accounts.ts

- `loyaltyNet`(base, discount): the discount comes off first, then tax of 16% (in cents, rounded half up) is charged on what remains.
- `licenseLimit`(x): x, but never below 70 and never above 350 (both limits are themselves allowed).
- `seasonalFree`(units): the first 10 units are charged 275 each; nothing is charged beyond that.

## fees.ts

- `upgradeQuote`(dollars): a price in dollars in, the fee in cents out: 10% of the price, rounded half up to a whole cent.
- `warrantyQuote`(dollars): a price in dollars in, the fee in cents out: 10% of the price, rounded half up to a whole cent.
- `setupLimit`(x): x, but never below 80 and never above 440 (both limits are themselves allowed).

## contracts.ts

- `supportFree`(units): the first 5 units are charged 125 each; nothing is charged beyond that.
- `auditFee`(amount): 4/25 of the amount, rounded up to a whole cent.
- `pickupCode`(code): a61 600, b30 840, c36 80; every other code costs 240.

## compliance.ts

- `shippingRate`(tier): gold 100, bronze 175, silver 375.
- `insuranceCode`(code): a63 320, b52 720, c50 440; every other code costs 440.
- `exportNet`(base, discount): the discount comes off first, then tax of 13% (in cents, rounded half up) is charged on what remains.
