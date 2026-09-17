/**
 * Explicit replacement registration + directed-ask handoff: red-first regressions on main (9d069ee).
 * Run: npx tsx --test scripts/replacement-registration.test.ts
 * Ported from swarm/swarm-200839-replacement-reg/openrouter-recruit-18 (06a1b0d, 3befff4, 1a6a548).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub, HubError } from '../src/hub.js';

function fixture(dataDir?: string) {
  const hub = new Hub({ dataDir });
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
function room(hub: Hub, name: string) { return (hub as any).rooms.get(name) as { participants: Map<string, any>; proposals: Map<string, any>; messages: any[] }; }
function error(f: ReturnType<typeof fixture>, text = '@old respond') {
  try { f.hub.send(f.room.name, f.sender.id, text, undefined, true); }
  catch (e) { assert.ok(e instanceof HubError); return e.message; }
  assert.fail('expected departed refusal');
}
function leave(hub: Hub, name: string, id: string) {
  const r = room(hub, name);
  for (const pr of r.proposals.values()) if (pr.status === 'open') (hub as any).evaluate(r, pr, 'abstain');
  hub.leave(name, id);
}
function focusOf(hub: Hub, roomName: string, pid: string) {
  return (hub as any).attentionFocus(room(hub, roomName), room(hub, roomName).participants.get(pid));
}

// ---------- ported registration + one-use proof regressions ----------

for (const by of ['id', 'name'] as const) test(`explicit registration binds ids and suggests successor (by ${by})`, () => {
  const f = fixture();
  register(f.hub, f.room.name, by === 'id' ? f.old.id : f.old.name, 'unrelated');
  const successor = joinSuccessor(f.hub, f.room.name, 'unrelated');
  assert.equal(successor.replacementOf, f.old.id);
  assert.equal((f.old as any).replacedBy, successor.id);
  assert.equal(f.old.active, false);
  assert.match(error(f), /"old" has left the room; their replacement is "unrelated"/);
});

test('unregistered suffix join leaves legacy message byte-for-byte unchanged', () => {
  const f = fixture();
  f.hub.leave(f.room.name, f.old.id);
  const joiner = f.hub.join(f.room.name, 'old-r1', 'test').participant as any;
  assert.equal(joiner.replacementOf, undefined);
  assert.equal((f.old as any).replacedBy, undefined);
  assert.equal(error(f), 'Cannot send: "old" has left the room. Remove the departed @-mention or address an active participant; no replacement is recorded.');
});

test('reservation without successor never recommends nonexistent seat', () => {
  const f = fixture(); register(f.hub, f.room.name, 'old', 'new');
  assert.match(error(f), /no replacement is recorded\.$/);
});

for (const reclaim of [true, false]) test(`reactivation does not manufacture links (reclaim=${reclaim})`, () => {
  const f = fixture(); f.hub.leave(f.room.name, f.old.id);
  const p = f.hub.join(f.room.name, 'old', 'test', { replacementOf: 'sender' } as any, reclaim ? f.old.id : undefined).participant as any;
  assert.equal(p.id, f.old.id);
  assert.equal(p.replacementOf, undefined);
  assert.equal((f.old as any).replacedBy, undefined);
});

test('multiple departed mentions map each independently including unlinked', () => {
  const f = fixture();
  const second = f.hub.join(f.room.name, 'second', 'test').participant;
  const unlinked = f.hub.join(f.room.name, 'unlinked', 'test').participant;
  for (const p of [f.old, second]) { register(f.hub, f.room.name, p.id, `${p.name}-next`); joinSuccessor(f.hub, f.room.name, `${p.name}-next`); }
  leave(f.hub, f.room.name, unlinked.id);
  const text = error(f, '@old @second @unlinked respond');
  assert.match(text, /"old" has left the room; their replacement is "old-next"/);
  assert.match(text, /"second" has left the room; their replacement is "second-next"/);
  assert.match(text, /"unlinked" has left the room; no replacement is recorded/);
});

test('chain follows latest active explicitly linked successor', () => {
  const f = fixture(); register(f.hub, f.room.name, 'old', 'old-r1');
  const r1 = joinSuccessor(f.hub, f.room.name, 'old-r1');
  register(f.hub, f.room.name, r1.id, 'old-r2');
  joinSuccessor(f.hub, f.room.name, 'old-r2');
  assert.match(error(f), /replacement is "old-r2"/);
  assert.match(error(f, '@old-r1 respond'), /replacement is "old-r2"/);
});

test('inactive successor is never recommended', () => {
  const f = fixture(); register(f.hub, f.room.name, 'old', 'next');
  const next = joinSuccessor(f.hub, f.room.name, 'next');
  leave(f.hub, f.room.name, next.id);
  assert.match(error(f), /no replacement is recorded\.$/);
});

for (const scenario of ['missing', 'same', 'existing', 'duplicate'] as const) test(`invalid registration (${scenario}) rejected atomically`, () => {
  const f = fixture();
  if (scenario === 'duplicate') register(f.hub, f.room.name, 'old', 'next');
  const snapshot = () => JSON.stringify([...room(f.hub, f.room.name).participants.values()].map((p: any) => [p.id, p.name, p.active]));
  const before = snapshot();
  const pred = scenario === 'missing' ? 'missing' : 'old';
  const succ = scenario === 'same' ? 'old' : scenario === 'existing' ? 'sender' : 'other';
  assert.throws(() => register(f.hub, f.room.name, pred, succ), HubError);
  assert.equal(snapshot(), before);
});

test('reservation rejects a wrong or missing join token without consuming it', () => {
  const f = fixture(); register(f.hub, f.room.name, 'old', 'next');
  for (const opts of [{}, { replacementToken: 'wrong' }]) {
    assert.throws(() => f.hub.join(f.room.name, 'next', 'test', opts as any), HubError);
    assert.equal([...room(f.hub, f.room.name).participants.values()].some((p: any) => p.name === 'next'), false);
  }
  assert.equal(joinSuccessor(f.hub, f.room.name, 'next').replacementOf, f.old.id);
});

test('token is scoped to its room and name and consumed once', () => {
  const f = fixture(); register(f.hub, f.room.name, 'old', 'next');
  const opts = { replacementToken: tokens.get('next') } as any;
  assert.throws(() => f.hub.join(f.room.name, 'wrong-name', 'test', opts), HubError);
  f.hub.createRoom('other');
  assert.throws(() => f.hub.join('other', 'next', 'test', opts), HubError);
  joinSuccessor(f.hub, f.room.name, 'next');
  assert.throws(() => f.hub.join(f.room.name, 'another', 'test', opts), HubError);
});

test('registration and links survive reload without recommending inactive restored seats', () => {
  const dir = mkdtempSync(join(tmpdir(), 'replacement-test-'));
  try {
    const f = fixture(dir); register(f.hub, f.room.name, 'old', 'next');
    const hub2 = new Hub({ dataDir: dir });
    const next = joinSuccessor(hub2, f.room.name, 'next');
    assert.equal(next.replacementOf, f.old.id);
    const hub3 = new Hub({ dataDir: dir }); const r = hub3.getRoom(f.room.name);
    assert.equal((r.participants.get(f.old.id) as any).replacedBy, next.id);
    const sender = hub3.join(r.name, 'sender', 'test').participant;
    assert.match(error({ ...f, hub: hub3, room: r, sender }), /no replacement is recorded\.$/);
    hub3.join(r.name, 'next', 'test');
    assert.match(error({ ...f, hub: hub3, room: r, sender }), /replacement is "next"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- NEW: outstanding directed-ask handoff to the replacement ----------

test('outstanding directed ask is offered to the registered replacement', () => {
  const f = fixture();
  f.hub.send(f.room.name, f.sender.id, '@old please report', undefined, true);
  register(f.hub, f.room.name, f.old.id, 'next');
  const next = joinSuccessor(f.hub, f.room.name, 'next');
  const focus = focusOf(f.hub, f.room.name, next.id);
  assert.ok(focus, 'replacement inherits the outstanding ask as focus');
  assert.equal(focus.from.id, f.sender.id);
});

test('ask the departed already declined is not re-offered to the replacement', () => {
  const f = fixture();
  const ask = f.hub.send(f.room.name, f.sender.id, '@old please report', undefined, true);
  (room(f.hub, f.room.name).participants.get(f.old.id) as any).declinedAsks = [ask.id];
  register(f.hub, f.room.name, f.old.id, 'next');
  const next = joinSuccessor(f.hub, f.room.name, 'next');
  assert.equal(focusOf(f.hub, f.room.name, next.id), undefined);
});

test('ask answered before registration does not become the replacement focus', () => {
  const f = fixture();
  const ask = f.hub.send(f.room.name, f.sender.id, '@old please report', undefined, true);
  f.hub.send(f.room.name, f.old.id, 'done', ask.id, true);
  register(f.hub, f.room.name, f.old.id, 'next');
  const next = joinSuccessor(f.hub, f.room.name, 'next');
  assert.equal(focusOf(f.hub, f.room.name, next.id), undefined);
});

test('replacement pass on the inherited ask stops it being the focus', async () => {
  const f = fixture();
  f.hub.send(f.room.name, f.sender.id, '@old please report', undefined, true);
  register(f.hub, f.room.name, f.old.id, 'next');
  const next = joinSuccessor(f.hub, f.room.name, 'next');
  const delivered = await f.hub.wait(f.room.name, next.id, 0, 0);
  assert.equal(delivered[0]?.id, focusOf(f.hub, f.room.name, next.id)?.id);
  f.hub.pass(f.room.name, next.id);
  assert.equal(focusOf(f.hub, f.room.name, next.id), undefined);
});
