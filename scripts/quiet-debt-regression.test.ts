/**
 * Quiet-debt probe, exact repro from lobby inbox quiet-debt-failing-repro: an outstanding quiet
 * ask owed by a departed predecessor must still be offered to its registered replacement
 * (quiet-delivery-not-privacy); public debt likewise; an exact consumed token must be rejected.
 * Run: npx tsx --test scripts/quiet-debt-regression.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hub, HubError } from '../src/hub.js';

function fixture() {
  const hub = new Hub({});
  const { room, participant: sender } = hub.join('replacement', 'sender', 'test', { nudgeAfterMs: 0 });
  const old = hub.join(room.name, 'old', 'test').participant;
  return { hub, room, sender, old };
}
const tokens = new Map<string, string>();
function register(hub: Hub, room: string, predecessor: string, name: string) {
  const result = (hub as any).registerReplacement(room, predecessor, name);
  tokens.set(name, result.replacementToken);
}
function joinSuccessor(hub: Hub, room: string, name: string) {
  return hub.join(room, name, 'test', { replacementToken: tokens.get(name) } as any).participant as any;
}
function room(hub: Hub, name: string) { return (hub as any).rooms.get(name) as { participants: Map<string, any>; messages: any[]; proposals: Map<string, any> }; }
function leave(hub: Hub, roomName: string, id: string) {
  const r = room(hub, roomName);
  for (const pr of r.proposals.values()) if (pr.status === 'open') (hub as any).evaluate(r, pr, 'abstain');
  hub.leave(roomName, id);
}
function addressedBy(hub: Hub, roomName: string, p: any) {
  return (hub as any).addressedBy(room(hub, roomName), p);
}

for (const quiet of [false, true]) test(`outstanding ${quiet ? 'quiet' : 'public'} debt is offered to the registered successor`, () => {
  const f = fixture();
  const ask = f.hub.send(f.room.name, f.sender.id, '@old report', undefined, true, quiet);
  register(f.hub, f.room.name, f.old.id, 'new');
  const next = joinSuccessor(f.hub, f.room.name, 'new');
  assert.equal(next.replacementOf, f.old.id);
  const ids = addressedBy(f.hub, f.room.name, next).map((m: any) => m.id);
  assert.ok(ids.includes(ask.id), `${quiet ? 'quiet' : 'public'} ask ${ask.id} must be inherited by the successor; got: ${ids.join(',')}`);
});

test('exact consumed token cannot re-join or reactivate a departed successor', () => {
  const f = fixture();
  register(f.hub, f.room.name, f.old.id, 'new');
  const next = joinSuccessor(f.hub, f.room.name, 'new');
  leave(f.hub, f.room.name, next.id);
  assert.throws(
    () => f.hub.join(f.room.name, 'new', 'test', { replacementToken: tokens.get('new') } as any),
    (e: unknown) => e instanceof HubError && /consumed|reserved/i.test((e as HubError).message),
    'consumed token must not reactivate a departed successor',
  );
  assert.equal((next as any).active, false);
});
