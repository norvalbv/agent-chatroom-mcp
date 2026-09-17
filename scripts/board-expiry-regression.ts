/** Expiry + persisted manifest accounting. Run: npx tsx scripts/board-expiry-regression.ts */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Hub } from '../src/hub.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'board-expiry-'));
  const hub = new Hub({dataDir: dir});
  const { room, participant: p } = hub.join('expiry', 'A', 'test', { nudgeAfterMs: 0 }, undefined, 'a');
  return {dir, hub, room, p, cleanup: () => rmSync(dir, {recursive:true, force:true})};
}
test('handoff expiration is persisted and archived, not destroyed', () => {
  const f = fixture();
  try {
    const e = f.hub.setBoard('expiry', f.p.id, 'handoff/task', 'retained body', {expiresAt:'2000-01-01T00:00:00Z'} as any)!;
    assert.equal(e.expiresAt, '2000-01-01T00:00:00.000Z');
    assert.equal(f.hub.boardEntryExpired(f.room, 'handoff/task', e), true);
    assert.equal(f.room.board.get('handoff/task')?.text, 'retained body');
    const replay = new Hub({dataDir:f.dir});
    const r = replay.getRoom('expiry');
    assert.deepEqual(r.board.get('handoff/task'), e);
    assert.equal(replay.boardEntryExpired(r, 'handoff/task', r.board.get('handoff/task')!), true);
  } finally { f.cleanup(); }
});
test('pending required inbox survives expiry and sender exit; acknowledgement releases archive', () => {
  const f = fixture();
  try {
    const sender = f.hub.join('sender', 'Sender', 'test', {nudgeAfterMs:0}, undefined, 's').participant;
    const {key,entry} = f.hub.postToRoom('sender',sender.id,'expiry','note','ack required',true,{expiresAt:'2000-01-01T00:00:00Z'});
    assert.equal(entry.expiresAt, '2000-01-01T00:00:00.000Z');
    f.hub.leave('sender',sender.id);
    assert.deepEqual(f.hub.unacknowledged(f.room), [key]);
    assert.equal(f.hub.boardEntryExpired(f.room,key,entry), false);
    f.hub.setBoard('expiry',f.p.id,`${key}.ack`,'ack',{ttlSeconds:1} as any);
    assert.equal(f.hub.boardEntryExpired(f.room,key,entry), true);
    const replay = new Hub({dataDir:f.dir});
    assert.deepEqual(replay.unacknowledged(replay.getRoom('expiry')), []);
  } finally { f.cleanup(); }
});
test('expiry rejects unsupported prefixes, ambiguous and invalid expiry values', () => {
  const f = fixture();
  try {
    for (const opts of [{ttlSeconds:1}, {expiresAt:'invalid'}, {ttlSeconds:-1}, {ttlSeconds:Infinity}, {ttlSeconds:1,expiresAt:'2000-01-01'}]) {
      assert.throws(() => f.hub.setBoard('expiry', f.p.id, 'evidence/test', 'body', opts as any));
    }
    assert.throws(() => f.hub.setBoard('expiry', f.p.id, 'handoff/test', 'body', {expiresAt:'invalid'} as any));
    const e = f.hub.setBoard('expiry',f.p.id,'handoff/future','body',{ttlSeconds:60} as any)!;
    assert.equal(f.hub.boardEntryExpired(f.room,'handoff/future',e),false);
  } finally {f.cleanup();}
});
test('manifest bytes are actual serialized envelope bytes, no-change 2B, replay parity', () => {
  const f = fixture();
  try {
    const payload = {board_keys:['evidence/x']};
    f.hub.recordBoardManifest('expiry', payload);
    f.hub.recordBoardManifest('expiry', {});
    const expected = {version:1, waits:2, bytes:Buffer.byteLength(JSON.stringify(payload)) + 2, full:1, delta:0, empty:1};
    assert.deepEqual(f.hub.stats(f.hub.getRoom('expiry')).board_manifests, expected);
    assert.deepEqual(((h: Hub) => h.stats(h.getRoom('expiry')))(new Hub({dataDir:f.dir})).board_manifests, expected);
  } finally { f.cleanup(); }
});
