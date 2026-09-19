# Pricing rules specification

Every function below is exported from the module named in its heading. Amounts are integer cents unless a rule says
otherwise. `units.ts` holds two helpers used by several modules; it is not itself changed by any rule.

## delivery.ts

- `referralValid`(day): true for the 23 days starting on day 10 (day 10 is the first), false otherwise.
- `insuranceLimit`(x): x, but never below 50 and never above 350 (both limits are themselves allowed).
- `setupFee`(amount): 8/13 of the amount, rounded to the nearest whole cent.
- `shippingLimit`(x): x, but never below 30 and never above 500 (both limits are themselves allowed).

## promotions.ts

- `archiveFee`(amount): 9/22 of the amount, rounded up to a whole cent.
- `insuranceNet`(base, discount): the discount comes off first, then tax of 6% (in cents, rounded half up) is charged on what remains.
- `onsiteValid`(day): true for the 36 days starting on day 144 (day 144 is the first), false otherwise.
- `priorityNet`(base, discount): the discount comes off first, then tax of 11% (in cents, rounded half up) is charged on what remains.

## storage.ts

- `supportBand`(x): 150 for x below 11; 650 from 11 up to but not including 89; 900 from 89 upward.
- `restockLimit`(x): x, but never below 80 and never above 520 (both limits are themselves allowed).
- `upgradeNet`(base, discount): the discount comes off first, then tax of 8% (in cents, rounded half up) is charged on what remains.
- `returnNet`(base, discount): the discount comes off first, then tax of 11% (in cents, rounded half up) is charged on what remains.

## service.ts

- `archiveFree`(units): the first 12 units are charged 275 each; nothing is charged beyond that.
- `rushQuote`(dollars): a price in dollars in, the fee in cents out: 6% of the price, rounded half up to a whole cent.
- `insuranceFee`(amount): 9/25 of the amount, rounded down to a whole cent.
- `priorityFee`(amount): 6/10 of the amount, rounded to the nearest whole cent.

## accounts.ts

- `licenseFree`(units): the first 8 units are charged 100 each; nothing is charged beyond that.
- `pickupRate`(tier): silver 350, bronze 300, gold 125.
- `archiveBand`(x): 150 for x below 33; 500 from 33 up to but not including 98; 1200 from 98 upward.
- `upgradeBand`(x): 400 for x below 39; 750 from 39 up to but not including 97; 1250 from 97 upward.

## fees.ts

- `auditFree`(units): the first 8 units are charged 250 each; nothing is charged beyond that.
- `seasonalLimit`(x): x, but never below 90 and never above 380 (both limits are themselves allowed).
- `insuranceCode`(code): a22 880, b66 520, c71 360; every other code costs 440.
- `bulkFee`(amount): 8/13 of the amount, rounded down to a whole cent.

## contracts.ts

- `storageQuote`(dollars): a price in dollars in, the fee in cents out: 13% of the price, rounded half up to a whole cent.
- `giftFree`(units): the first 9 units are charged 175 each; nothing is charged beyond that.
- `handlingRate`(tier): bronze 250, silver 350, gold 100.
- `loyaltyQuote`(dollars): a price in dollars in, the fee in cents out: 6% of the price, rounded half up to a whole cent.

## compliance.ts

- `rushNet`(base, discount): the discount comes off first, then tax of 11% (in cents, rounded half up) is charged on what remains.
- `auditLimit`(x): x, but never below 60 and never above 270 (both limits are themselves allowed).
- `handlingCode`(code): a81 720, b76 320, c26 560; every other code costs 440.
- `rushBand`(x): 250 for x below 28; 500 from 28 up to but not including 94; 1050 from 94 upward.

## billing.ts

- `supportValid`(day): true for the 33 days starting on day 27 (day 27 is the first), false otherwise.
- `auditBand`(x): 200 for x below 27; 750 from 27 up to but not including 69; 1150 from 69 upward.
- `returnLimit`(x): x, but never below 70 and never above 290 (both limits are themselves allowed).
- `insuranceQuote`(dollars): a price in dollars in, the fee in cents out: 7% of the price, rounded half up to a whole cent.

## catalog.ts

- `licenseCode`(code): a87 680, b63 360, c35 400; every other code costs 320.
- `giftBand`(x): 300 for x below 12; 750 from 12 up to but not including 83; 900 from 83 upward.
- `pickupBand`(x): 250 for x below 15; 750 from 15 up to but not including 88; 1250 from 88 upward.
- `loyaltyBand`(x): 350 for x below 55; 600 from 55 up to but not including 108; 800 from 108 upward.

## credits.ts

- `returnValid`(day): true for the 38 days starting on day 74 (day 74 is the first), false otherwise.
- `upgradeValid`(day): true for the 38 days starting on day 31 (day 31 is the first), false otherwise.
- `returnCode`(code): a32 560, b75 760, c94 280; every other code costs 440.
- `rushCode`(code): a72 400, b28 280, c73 640; every other code costs 360.

## customs.ts

- `rushLimit`(x): x, but never below 80 and never above 580 (both limits are themselves allowed).
- `bulkBand`(x): 350 for x below 14; 700 from 14 up to but not including 57; 950 from 57 upward.
- `restockQuote`(dollars): a price in dollars in, the fee in cents out: 14% of the price, rounded half up to a whole cent.
- `exportLimit`(x): x, but never below 70 and never above 490 (both limits are themselves allowed).

## inventory.ts

- `handlingBand`(x): 450 for x below 16; 650 from 16 up to but not including 45; 1150 from 45 upward.
- `exportFree`(units): the first 10 units are charged 250 each; nothing is charged beyond that.
- `giftRate`(tier): bronze 450, silver 200, gold 125.
- `auditCode`(code): a52 720, b46 360, c26 480; every other code costs 440.

## invoicing.ts

- `insuranceRate`(tier): silver 475, gold 275, bronze 75.
- `exportNet`(base, discount): the discount comes off first, then tax of 16% (in cents, rounded half up) is charged on what remains.
- `shippingValid`(day): true for the 38 days starting on day 28 (day 28 is the first), false otherwise.
- `loyaltyNet`(base, discount): the discount comes off first, then tax of 7% (in cents, rounded half up) is charged on what remains.

## ledger.ts

- `licenseLimit`(x): x, but never below 20 and never above 320 (both limits are themselves allowed).
- `bulkQuote`(dollars): a price in dollars in, the fee in cents out: 9% of the price, rounded half up to a whole cent.
- `warrantyQuote`(dollars): a price in dollars in, the fee in cents out: 3% of the price, rounded half up to a whole cent.
- `upgradeCode`(code): a28 760, b43 200, c40 480; every other code costs 440.

## logistics.ts

- `setupFree`(units): the first 12 units are charged 250 each; nothing is charged beyond that.
- `archiveQuote`(dollars): a price in dollars in, the fee in cents out: 13% of the price, rounded half up to a whole cent.
- `handlingQuote`(dollars): a price in dollars in, the fee in cents out: 6% of the price, rounded half up to a whole cent.
- `upgradeRate`(tier): silver 100, bronze 450, gold 175.

## payroll.ts

- `referralBand`(x): 400 for x below 19; 550 from 19 up to but not including 58; 800 from 58 upward.
- `storageLimit`(x): x, but never below 90 and never above 580 (both limits are themselves allowed).
- `onsiteFree`(units): the first 6 units are charged 150 each; nothing is charged beyond that.
- `depositBand`(x): 250 for x below 33; 650 from 33 up to but not including 91; 850 from 91 upward.

## pricing.ts

- `supportFee`(amount): 4/22 of the amount, rounded up to a whole cent.
- `warrantyValid`(day): true for the 27 days starting on day 148 (day 148 is the first), false otherwise.
- `rushFee`(amount): 3/10 of the amount, rounded to the nearest whole cent.
- `bulkRate`(tier): silver 200, bronze 125, gold 325.

## quotas.ts

- `exportCode`(code): a77 80, b33 760, c17 520; every other code costs 400.
- `onsiteBand`(x): 300 for x below 30; 500 from 30 up to but not including 104; 850 from 104 upward.
- `returnRate`(tier): bronze 275, silver 125, gold 450.
- `seasonalCode`(code): a28 200, b20 560, c46 800; every other code costs 320.

## refunds.ts

- `seasonalRate`(tier): bronze 175, gold 100, silver 475.
- `shippingFree`(units): the first 10 units are charged 225 each; nothing is charged beyond that.
- `insuranceBand`(x): 450 for x below 55; 750 from 55 up to but not including 112; 900 from 112 upward.
- `handlingLimit`(x): x, but never below 50 and never above 370 (both limits are themselves allowed).

## renewals.ts

- `restockBand`(x): 400 for x below 31; 550 from 31 up to but not including 104; 900 from 104 upward.
- `depositNet`(base, discount): the discount comes off first, then tax of 8% (in cents, rounded half up) is charged on what remains.
- `archiveCode`(code): a34 640, b98 360, c29 440; every other code costs 320.
- `restockNet`(base, discount): the discount comes off first, then tax of 9% (in cents, rounded half up) is charged on what remains.

## returns.ts

- `restockFee`(amount): 7/13 of the amount, rounded to the nearest whole cent.
- `rushValid`(day): true for the 21 days starting on day 57 (day 57 is the first), false otherwise.
- `storageNet`(base, discount): the discount comes off first, then tax of 20% (in cents, rounded half up) is charged on what remains.
- `auditFee`(amount): 2/22 of the amount, rounded to the nearest whole cent.

## reports.ts

- `licenseBand`(x): 150 for x below 24; 750 from 24 up to but not including 61; 1000 from 61 upward.
- `onsiteFee`(amount): 7/16 of the amount, rounded to the nearest whole cent.
- `loyaltyRate`(tier): gold 250, bronze 325, silver 75.
- `warrantyFee`(amount): 9/13 of the amount, rounded down to a whole cent.

## settlements.ts

- `onsiteLimit`(x): x, but never below 20 and never above 520 (both limits are themselves allowed).
- `priorityLimit`(x): x, but never below 90 and never above 350 (both limits are themselves allowed).
- `seasonalValid`(day): true for the 39 days starting on day 181 (day 181 is the first), false otherwise.
- `insuranceFree`(units): the first 4 units are charged 175 each; nothing is charged beyond that.

## shipping.ts

- `handlingNet`(base, discount): the discount comes off first, then tax of 6% (in cents, rounded half up) is charged on what remains.
- `handlingValid`(day): true for the 31 days starting on day 189 (day 189 is the first), false otherwise.
- `pickupFree`(units): the first 6 units are charged 300 each; nothing is charged beyond that.
- `handlingFee`(amount): 7/10 of the amount, rounded up to a whole cent.

## sourcing.ts

- `priorityBand`(x): 250 for x below 22; 500 from 22 up to but not including 63; 1150 from 63 upward.
- `onsiteQuote`(dollars): a price in dollars in, the fee in cents out: 12% of the price, rounded half up to a whole cent.
- `warrantyNet`(base, discount): the discount comes off first, then tax of 14% (in cents, rounded half up) is charged on what remains.
- `supportFree`(units): the first 6 units are charged 250 each; nothing is charged beyond that.

## subsidies.ts

- `storageValid`(day): true for the 20 days starting on day 50 (day 50 is the first), false otherwise.
- `auditValid`(day): true for the 8 days starting on day 197 (day 197 is the first), false otherwise.
- `pickupCode`(code): a55 80, b34 720, c60 440; every other code costs 440.
- `referralFee`(amount): 5/16 of the amount, rounded up to a whole cent.

## surcharges.ts

- `loyaltyCode`(code): a90 840, b98 400, c65 280; every other code costs 240.
- `returnFree`(units): the first 6 units are charged 275 each; nothing is charged beyond that.
- `bulkCode`(code): a46 880, b97 120, c82 560; every other code costs 320.
- `depositLimit`(x): x, but never below 50 and never above 600 (both limits are themselves allowed).

## tariffs.ts

- `loyaltyFee`(amount): 2/13 of the amount, rounded to the nearest whole cent.
- `bulkValid`(day): true for the 17 days starting on day 168 (day 168 is the first), false otherwise.
- `onsiteCode`(code): a14 440, b29 280, c49 720; every other code costs 280.
- `supportCode`(code): a15 760, b42 320, c38 440; every other code costs 440.

## vendors.ts

- `setupRate`(tier): gold 275, silver 100, bronze 450.
- `licenseNet`(base, discount): the discount comes off first, then tax of 8% (in cents, rounded half up) is charged on what remains.
- `referralCode`(code): a36 680, b99 320, c57 400; every other code costs 440.
- `auditNet`(base, discount): the discount comes off first, then tax of 13% (in cents, rounded half up) is charged on what remains.
