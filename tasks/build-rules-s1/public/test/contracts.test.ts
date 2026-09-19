import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contracts from '../src/contracts.ts';

test('supportCode', () => { assert.deepEqual(contracts.supportCode("c49"), 200); });
test('licenseNet', () => { assert.deepEqual(contracts.licenseNet(25050, 3333), 26060); });
test('onsiteValid', () => { assert.deepEqual(contracts.onsiteValid(149), false); });
