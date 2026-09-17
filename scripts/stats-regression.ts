/** Board telemetry contract: npx tsx scripts/stats-regression.ts */
import assert from 'node:assert/strict';
import { Hub } from '../src/hub.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSessionServer } from '../src/server.js';

Hub.DEFAULT_NUDGE_MS = 0;
const hub = new Hub();
const { room, participant } = hub.join('stats-board', 'builder', 'codex');
const stats = () => hub.stats(room) as any;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const entry = { by: 'builder', text: 'body', updatedAt: '2026-01-01T00:00:00.000Z' };
room.board.set('evidence/雪🙂', entry);
const original = stats();
for (const key of ['room', 'state', 'duration_ms', 'time_to_conclusion_ms', 'messages_by_kind', 'per_participant', 'proposals', 'amendments', 'challenges', 'board_entries', 'refusals', 'call_outcomes', 'refusal_rates', 'refusal_rate_coverage', 'near_simultaneous_replies', 'unanswered_human_messages']) assert.ok(key in original, key);
assert.ok(original.board_manifest, 'stats must expose board_manifest telemetry');
assert.equal(original.board_manifest.coverage, 'since-process-start');
const full = { board_keys: [...room.board.keys()] };
assert.ok(bytes(full) > JSON.stringify(full).length, 'fixture distinguishes UTF8 bytes from chars');
assert.equal(original.board_manifest.current_full_manifest_bytes, bytes(full));
assert.equal(original.board_manifest.entries_by_prefix['evidence/'], 1);
assert.equal(original.board_manifest.entries_by_prefix.other, 0);
(hub as any).observeBoardManifest(room, full);
const first = stats().board_manifest;
assert.equal(first.waits_observed, 1);
assert.equal(first.full_baseline_manifest_bytes, bytes(full));
assert.equal(first.shipped_manifest_bytes, bytes(full));
assert.equal(first.keys_shipped, 1);
assert.equal(first.deleted_tombstones_shipped, 0);
// Text changes and same-key writes do not alter a key-only manifest.
room.board.set('evidence/雪🙂', { ...entry, text: 'different body' });
assert.equal(stats().board_manifest.current_full_manifest_bytes, bytes(full));
(hub as any).observeBoardManifest(room, {});
room.board.delete('evidence/雪🙂');
const deletion = { board_delta: { keys: [], tombstones: ['evidence/雪🙂'] } };
(hub as any).observeBoardManifest(room, deletion);
assert.equal(stats().board_manifest.waits_observed, 3);
assert.equal(stats().board_manifest.full_baseline_manifest_bytes, bytes(full) * 2 + bytes({ board_keys: [] }));
assert.equal(stats().board_manifest.shipped_manifest_bytes, bytes(full) + bytes({}) + bytes(deletion));
assert.equal(stats().board_manifest.deleted_tombstones_shipped, 1);
assert.equal(stats().board_manifest.entries_by_prefix['evidence/'], 0);
const cursor = participant.lastSeenSeq;
assert.deepEqual(stats().board_manifest, stats().board_manifest, 'stats reads must not advance counters');
assert.equal(participant.lastSeenSeq, cursor);
const fresh = new Hub();
assert.equal((fresh.stats(fresh.createRoom('fresh')) as any).board_manifest.waits_observed, 0);
// The actual MCP wait path must invoke the observer, not just direct callers.
const session = createSessionServer(fresh);
const client = new Client({ name: 'stats-regression', version: '1' });
const [ct, st] = InMemoryTransport.createLinkedPair();
await session.server.connect(st);
await client.connect(ct);
try {
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  await call('join_room', { room: 'wire', name: 'tester' });
  const wired = fresh.getRoom('wire');
  wired.board.set('sources/雪', entry);
  const reply = await call('wait_for_messages', { room: 'wire', timeout_ms: 0 });
  const manifest: Record<string, unknown> = {};
  for (const field of ['board_keys', 'board_delta', 'board_reset']) if (field in reply) manifest[field] = reply[field];
  assert.ok(Object.keys(manifest).length, 'wait must ship a manifest envelope');
  const measured = (fresh.stats(wired) as any).board_manifest;
  assert.equal(measured.waits_observed, 1, 'successful MCP wait observed exactly once');
  assert.equal(measured.shipped_manifest_bytes, bytes(manifest));
  assert.deepEqual((fresh.stats(wired) as any).board_manifest, measured);
} finally {
  await client.close();
  await session.server.close();
}
console.log('STATS BOARD REGRESSION OK');
