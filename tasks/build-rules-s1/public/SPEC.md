# Pricing rules specification

Every function below is exported from the module named in its heading. Amounts are integer cents unless a rule says
otherwise. `units.ts` holds two helpers used by several modules; it is not itself changed by any rule.

## delivery.ts

- `handlingCode`(code): a51 840, b79 320, c23 520; every other code costs 320.
- `returnNet`(base, discount): the discount comes off first, then tax of 11% (in cents, rounded half up) is charged on what remains.
- `upgradeFee`(amount): 4/13 of the amount, rounded down to a whole cent.

## promotions.ts

- `insuranceValid`(day): true for the 19 days starting on day 40 (day 40 is the first), false otherwise.
- `priorityFree`(units): the first 6 units are charged 225 each; nothing is charged beyond that.
- `giftNet`(base, discount): the discount comes off first, then tax of 19% (in cents, rounded half up) is charged on what remains.

## storage.ts

- `licenseBand`(x): 450 for x below 10; 600 from 10 up to but not including 30; 1200 from 30 upward.
- `depositLimit`(x): x, but never below 20 and never above 380 (both limits are themselves allowed).
- `archiveBand`(x): 400 for x below 27; 550 from 27 up to but not including 107; 850 from 107 upward.

## service.ts

- `referralRate`(tier): silver 125, bronze 400, gold 200.
- `auditLimit`(x): x, but never below 40 and never above 500 (both limits are themselves allowed).
- `supportFee`(amount): 4/10 of the amount, rounded up to a whole cent.

## accounts.ts

- `exportQuote`(dollars): a price in dollars in, the fee in cents out: 4% of the price, rounded half up to a whole cent.
- `restockNet`(base, discount): the discount comes off first, then tax of 7% (in cents, rounded half up) is charged on what remains.
- `onsiteQuote`(dollars): a price in dollars in, the fee in cents out: 12% of the price, rounded half up to a whole cent.

## fees.ts

- `warrantyCode`(code): a55 400, b63 320, c14 800; every other code costs 440.
- `shippingLimit`(x): x, but never below 20 and never above 400 (both limits are themselves allowed).
- `storageValid`(day): true for the 16 days starting on day 10 (day 10 is the first), false otherwise.

## contracts.ts

- `pickupRate`(tier): gold 125, silver 425, bronze 175.
- `setupValid`(day): true for the 9 days starting on day 102 (day 102 is the first), false otherwise.
- `bulkCode`(code): a75 560, b34 80, c85 640; every other code costs 440.

## compliance.ts

- `loyaltyFree`(units): the first 8 units are charged 275 each; nothing is charged beyond that.
- `seasonalBand`(x): 450 for x below 18; 600 from 18 up to but not including 51; 900 from 51 upward.
- `rushFree`(units): the first 3 units are charged 150 each; nothing is charged beyond that.
