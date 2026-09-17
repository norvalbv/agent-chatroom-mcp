/** Measured serialization on an explicitly SYNTHETIC schedule, NOT historical wait traffic.
 * Run: npx tsx scripts/board-manifest-measure.ts /absolute/path/to/room.jsonl
 * One synthetic observer waits twice after every board event: one change poll + one idle poll.
 * Uses production applyBoard reducer and boardManifest, no modeled delta implementation.
 */
import { readFileSync } from 'node:fs';
import { Hub } from '../src/hub.js';
const file = process.argv[2];
if (!file) throw new Error('Pass the historical JSONL path');
const events = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const hub = new Hub();
const { room, participant } = hub.join('measurement', 'synthetic-observer', 'test', { nudgeAfterMs: 0 });
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
let boardEvents = 0, polls = 0, before = 0, after = 0;
const snapshots: { keys: number; array_bytes: number; wrapper_bytes: number }[] = [];
for (const event of events) {
  if (event.type !== 'board') continue;
  // Deliberate test harness access to the exact live/replay reducer, preserving all historical entries.
  (hub as any).applyBoard(room, event.key, event.entry);
  boardEvents++;
  if (room.board.size === 132 && !snapshots.length) snapshots.push({ keys: 132, array_bytes: bytes([...room.board.keys()]), wrapper_bytes: bytes({ board_keys: [...room.board.keys()] }) });
  for (let idle = 0; idle < 2; idle++) {
    const oldEnvelope = { board_keys: [...room.board.keys()] };
    const envelope = hub.boardManifest(room.name, participant.id);
    before += bytes(oldEnvelope);
    after += Object.keys(envelope).length ? bytes(envelope) : 0; // no fields embedded into wait response
    polls++;
  }
}
snapshots.push({ keys: room.board.size, array_bytes: bytes([...room.board.keys()]), wrapper_bytes: bytes({ board_keys: [...room.board.keys()] }) });
console.log(JSON.stringify({ historical_wait_receipts: 'absent; historical traffic unknown', schedule: 'SYNTHETIC one observer, change poll plus idle poll after every board event; all prefixes', encoding: 'UTF-8 compact JSON board-field envelope; absent fields count 0; excludes whole MCP framing', board_events: boardEvents, snapshots, polls, before_total: before, after_total: after, observed_manifest_stats: hub.stats(room).board_manifests, before_mean: before / polls, after_mean: after / polls, savings_percent: 100 * (1 - after / before) }, null, 2));
