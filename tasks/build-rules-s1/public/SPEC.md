# Pricing rules specification

Every function below is exported from the module named in its heading. Amounts are integer cents unless a rule says
otherwise. `units.ts` holds two helpers used by several modules; it is not itself changed by any rule.

## delivery.ts

- `depositValid`(day): true for the 7 days starting on day 80 (day 80 is the first), false otherwise.
- `seasonalLimit`(x): x, but never below 20 and never above 500 (both limits are themselves allowed).
- `upgradeValid`(day): true for the 36 days starting on day 13 (day 13 is the first), false otherwise.

## promotions.ts

- `insuranceRate`(tier): bronze 275, gold 325, silver 150.
- `upgradeFree`(units): the first 5 units are charged 275 each; nothing is charged beyond that.
- `referralBand`(x): 350 for x below 27; 700 from 27 up to but not including 72; 1050 from 72 upward.

## storage.ts

- `priorityCode`(code): a15 680, b55 520, c41 80; every other code costs 280.
- `loyaltyRate`(tier): bronze 275, gold 75, silver 375.
- `returnBand`(x): 200 for x below 11; 500 from 11 up to but not including 64; 1050 from 64 upward.

## service.ts

- `bulkNet`(base, discount): the discount comes off first, then tax of 10% (in cents, rounded half up) is charged on what remains.
- `handlingValid`(day): true for the 13 days starting on day 22 (day 22 is the first), false otherwise.
- `referralNet`(base, discount): the discount comes off first, then tax of 10% (in cents, rounded half up) is charged on what remains.

## accounts.ts

- `warrantyQuote`(dollars): a price in dollars in, the fee in cents out: 3% of the price, rounded half up to a whole cent.
- `auditFee`(amount): 7/13 of the amount, rounded down to a whole cent.
- `referralLimit`(x): x, but never below 70 and never above 350 (both limits are themselves allowed).

## fees.ts

- `giftRate`(tier): silver 425, gold 125, bronze 200.
- `shippingQuote`(dollars): a price in dollars in, the fee in cents out: 9% of the price, rounded half up to a whole cent.
- `insuranceFee`(amount): 8/10 of the amount, rounded to the nearest whole cent.

## contracts.ts

- `supportCode`(code): a13 440, b27 640, c49 200; every other code costs 400.
- `licenseNet`(base, discount): the discount comes off first, then tax of 20% (in cents, rounded half up) is charged on what remains.
- `onsiteValid`(day): true for the 28 days starting on day 121 (day 121 is the first), false otherwise.

## compliance.ts

- `onsiteCode`(code): a33 320, b89 480, c98 720; every other code costs 240.
- `priorityLimit`(x): x, but never below 90 and never above 350 (both limits are themselves allowed).
- `handlingQuote`(dollars): a price in dollars in, the fee in cents out: 8% of the price, rounded half up to a whole cent.
