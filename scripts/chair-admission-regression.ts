/** Rejected joins must never claim the room's chair. Run: npx tsx scripts/chair-admission-regression.ts */
import assert from 'node:assert/strict';
import { Hub } from '../src/hub.js';

const hub = new Hub();
const room = hub.createRoom('chair-admission');
assert.throws(() => hub.join(room.name, 'bad\nname', 'human', {}, undefined, undefined, 'chair'), /Display names/);
assert.equal(room.chair, undefined, 'rejected invalid-name join must not reserve chair');
const chair = hub.join(room.name, 'Human', 'human', {}, undefined, undefined, 'chair').participant;
assert.equal(room.chair, 'Human');
assert.equal(chair.role, 'chair');
assert.throws(() => hub.join(room.name, 'Other', 'human', {}, undefined, undefined, 'chair'), /chair is Human/);
assert.equal(room.chair, 'Human', 'existing binding remains unchanged');
console.log('PASS rejected chair admission is atomic; valid binding and exclusivity preserved');
