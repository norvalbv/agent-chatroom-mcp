/** Chair binding must survive hub restart (replay parity). Run: npx tsx scripts/chair-replay-regression.ts */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub } from '../src/hub.js';

const dataDir = mkdtempSync(join(tmpdir(), 'chair-replay-'));
try {
  const hub1 = new Hub({ dataDir });
  const room = hub1.createRoom('chair-replay');
  hub1.join(room.name, 'GoodChair', 'openrouter', {}, undefined, 's1', 'chair');
  const hub2 = new Hub({ dataDir });
  const room2 = hub2.getRoom('chair-replay');
  assert.equal(room2.chair, 'GoodChair', 'valid chair binding must survive replay');
  const hub3 = new Hub({ dataDir });
  const r3 = hub3.createRoom('chair-replay-2');
  assert.throws(() => hub3.join(r3.name, 'bad\nname', 'openrouter', {}, undefined, 's2', 'chair'));
  const hub4 = new Hub({ dataDir });
  assert.equal(hub4.getRoom('chair-replay-2').chair, undefined, 'rejected admission must not reserve chair across replay');
  console.log('PASS chair binding and exclusivity survive replay; rejected admission leaves none');
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
