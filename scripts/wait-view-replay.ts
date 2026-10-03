/** Replay parsed historical wait observations through the actual formatter; bytes only, no provider requests. */
import { readFileSync } from 'node:fs';
import { createWaitView, type WaitView } from '../src/hub/wait-view.js';
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { seat: string; room: string; view: WaitView; original_bytes: number }[];
const seats = new Map<string, object>();
const render = createWaitView();
const result = { waits: 0, compacted: 0, original_bytes: 0, candidate_bytes: 0, empty_original_bytes: 0, empty_candidate_bytes: 0, empty_waits: 0,
  note: 'Same ordered historical observations through the actual formatter. Pretty JSON retained to isolate state compaction from serialization. Provider tokens/calls and task outcome unchanged by this replay.' };
for (const row of rows) {
  const key = `${row.seat}:${row.room}`;
  if (!seats.has(key)) seats.set(key, {});
  const next = render(seats.get(key)!, row.view);
  const after = next === row.view ? row.original_bytes : Buffer.byteLength(JSON.stringify(next, null, 2));
  result.waits++; result.original_bytes += row.original_bytes; result.candidate_bytes += after;
  if (next.unchanged) result.compacted++;
  if (!row.view.messages.length && !row.view.addressed_to_you?.length) {
    result.empty_waits++; result.empty_original_bytes += row.original_bytes; result.empty_candidate_bytes += after;
  }
}
console.log(JSON.stringify(result, null, 2));
