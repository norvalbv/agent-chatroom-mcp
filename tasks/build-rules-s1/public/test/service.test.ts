import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as service from '../src/service.ts';

test('auditLimit', () => { assert.deepEqual(service.auditLimit(496), 496); });
test('supportFee', () => { assert.deepEqual(service.supportFee(100), 40); });
