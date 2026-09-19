import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as catalog from '../src/catalog.ts';

test('licenseCode', () => { assert.deepEqual(catalog.licenseCode("c35"), 400); });
test('giftBand', () => { assert.deepEqual(catalog.giftBand(123), 900); });
test('pickupBand', () => { assert.deepEqual(catalog.pickupBand(128), 1250); });
test('loyaltyBand', () => { assert.deepEqual(catalog.loyaltyBand(148), 800); });
