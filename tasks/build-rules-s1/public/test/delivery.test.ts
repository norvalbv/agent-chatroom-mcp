import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as delivery from '../src/delivery.ts';

test('handlingCode', () => { assert.deepEqual(delivery.handlingCode("c23"), 520); });
test('returnNet', () => { assert.deepEqual(delivery.returnNet(0, 0), 0); });
test('upgradeFee', () => { assert.deepEqual(delivery.upgradeFee(130), 40); });
