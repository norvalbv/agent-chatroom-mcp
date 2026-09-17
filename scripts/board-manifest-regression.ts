/** Core board delivery regressions. Run: npx tsx scripts/board-manifest-regression.ts */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Hub } from '../src/hub.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'board-manifest-'));
  const hub = new Hub({ dataDir: dir });
  const name = 'board-test';
  const a = hub.join(name, 'A', 'test', { nudgeAfterMs: 0 }, undefined, 'a').participant;
  const b = hub.join(name, 'B', 'test', {}, undefined, 'b').participant;
  const manifest = (pid = a.id, follow?: string[] | null, full = false) => hub.boardManifest(name, pid, follow ?? undefined, full);
  return { hub, name, a, b, dir, manifest, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('first wait full; changes, deletions, no-change zero board bytes; independent cursors', () => {
  const f = fixture(); try {
    f.hub.setBoard(f.name, f.a.id, 'evidence/a', 'one');
    assert.deepEqual(f.manifest(), { board_keys: ['evidence/a'], board_reset: true });
    assert.deepEqual(f.manifest(), {});
    f.hub.setBoard(f.name, f.a.id, 'evidence/a', 'two');
    f.hub.setBoard(f.name, f.a.id, 'evidence/b', 'new');
    assert.deepEqual(f.manifest(), { board_delta: { keys: ['evidence/a', 'evidence/b'], tombstones: [] } });
    f.hub.setBoard(f.name, f.a.id, 'evidence/a', '');
    assert.deepEqual(f.manifest(), { board_delta: { keys: [], tombstones: ['evidence/a'] } });
    assert.deepEqual(f.manifest(f.b.id), { board_keys: ['evidence/b'], board_reset: true });
    assert.equal(f.hub.getRoom(f.name).boardVersion, 4);
  } finally { f.cleanup(); }
});

test('follow persists; expansion backfills; narrowing resets; gates stay visible', () => {
  const f = fixture(); try {
    for (const key of ['evidence/a', 'sources/a', 'verify/check']) f.hub.setBoard(f.name, f.a.id, key, 'value');
    f.hub.setBoard(f.name, f.a.id, 'claim/task', JSON.stringify({ owner: 'A', team: ['A'], status: 'open' }));
    const outsider = f.hub.join('sender', 'Sender', 'test', { nudgeAfterMs: 0 }, undefined, 'sender').participant;
    f.hub.postToRoom('sender', outsider.id, f.name, 'request', 'please acknowledge', true);
    const gates = ['verify/check', 'claim/task', 'inbox/sender/request'];
    assert.deepEqual(f.manifest(f.a.id, ['evidence/']), { board_keys: ['evidence/a', ...gates], board_reset: true });
    assert.deepEqual(f.manifest(), {});
    assert.deepEqual(f.manifest(f.a.id, ['evidence/', 'sources/']), { board_keys: ['evidence/a', 'sources/a', ...gates], board_reset: true });
    assert.deepEqual(f.manifest(f.a.id, []), { board_keys: [...gates], board_reset: true });
    assert.deepEqual(f.manifest(f.a.id, ['evidence/']), { board_keys: ['evidence/a', ...gates], board_reset: true });
    f.hub.setBoard(f.name, f.a.id, 'evidence/a', 'v2');
    assert.deepEqual(f.manifest(), { board_delta: { keys: ['evidence/a'], tombstones: [] } });
    f.hub.setBoard(f.name, f.a.id, 'sources/a', 'v2');
    assert.deepEqual(f.manifest(), {});
    f.hub.setBoard(f.name, f.a.id, 'inbox/sender/request.ack', 'ack');
    assert.deepEqual(f.manifest(), { board_delta: { keys: [], tombstones: ['inbox/sender/request'] } });
  } finally { f.cleanup(); }
});

test('leave/rejoin, active reconnect, and explicit hub reset recover dropped delta', () => {
  const f = fixture(); try {
    f.hub.setBoard(f.name, f.a.id, 'evidence/a', 'v1');
    f.manifest();
    f.hub.setBoard(f.name, f.a.id, 'evidence/a', 'v2');
    f.manifest(); // transport dropped this response; no delivery ack exists
    f.hub.leave(f.name, f.a.id);
    f.hub.join(f.name, 'A', 'test', {}, f.a.id, 'a');
    assert.deepEqual(f.manifest(), { board_keys: ['evidence/a'], board_reset: true });
    f.hub.join(f.name, 'A', 'test', {}, f.a.id, 'a');
    assert.deepEqual(f.manifest(), { board_keys: ['evidence/a'], board_reset: true });
    assert.deepEqual(f.manifest(f.a.id, null, true), { board_keys: ['evidence/a'], board_reset: true });
    assert.deepEqual(f.manifest(), {});
  } finally { f.cleanup(); }
});

test('a refused/errored manifest call leaves the board cursor untouched', () => {
  const f = fixture(); try {
    f.manifest();
    f.hub.setBoard(f.name, f.a.id, 'evidence/a', 'v2');
    assert.throws(() => f.hub.boardManifest(f.name, 'p_missing'), /not a participant/);
    assert.deepEqual(f.manifest(), { board_delta: { keys: ['evidence/a'], tombstones: [] } });
  } finally { f.cleanup(); }
});

test('replay reconstructs board versions and tombstones but resets delivery cursors', () => {
  const f = fixture(); try {
    f.hub.setBoard(f.name, f.a.id, 'evidence/a', 'v1');
    f.hub.setBoardAs(f.name, 'system', 'claim/system', '{}');
    f.hub.setBoard(f.name, f.a.id, 'evidence/a', '');
    f.manifest();
    const restored = new Hub({ dataDir: f.dir });
    const room = restored.getRoom(f.name);
    assert.equal(room.boardVersion, f.hub.getRoom(f.name).boardVersion);
    assert.deepEqual([...room.boardVersions], [...f.hub.getRoom(f.name).boardVersions]);
    assert.equal(restored.boardManifestTelemetry(f.hub.getRoom(f.name)).waits, 1);
    restored.join(f.name, 'A', 'test', {}, f.a.id, 'a');
    assert.deepEqual(restored.boardManifest(f.name, f.a.id), { board_keys: ['claim/system'], board_reset: true });
  } finally { f.cleanup(); }
});

test('assemble after poll wake; concurrent completions do not duplicate delta', async () => {
  const f = fixture(); try {
    f.manifest();
    const seq = f.hub.getRoom(f.name).messages.at(-1)!.seq;
    const poll = f.hub.wait(f.name, f.a.id, seq, 2000);
    f.hub.setBoard(f.name, f.b.id, 'evidence/late', 'arrived while waiting');
    await poll;
    const results = await Promise.all([Promise.resolve().then(() => f.manifest()), Promise.resolve().then(() => f.manifest())]);
    assert.deepEqual(results, [{ board_delta: { keys: ['evidence/late'], tombstones: [] } }, {}]);
    const st = f.hub.boardManifestTelemetry(f.hub.getRoom(f.name));
    assert.equal(st.waits, 3);
    assert.equal(st.board_bytes_total, Hub.manifestBytes({ board_keys: [], board_reset: true }) + Hub.manifestBytes(results[0]) + Hub.manifestBytes({}));
    assert.equal(st.board_bytes_mean, Math.round((st.board_bytes_total / 3) * 10) / 10);
  } finally { f.cleanup(); }
});
