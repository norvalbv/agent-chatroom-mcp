/** Replay parsed historical wait observations through the actual formatter; bytes only, no provider requests. */
import { readFileSync } from 'node:fs';
import { createWaitView, type WaitView } from '../src/hub/wait-view.js';
type Row = { seat: string; room: string; view: WaitView; original_bytes: number };
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rows: Row[] = Array.isArray(input) ? input : [];
// A room -> Claude transcript paths manifest is also accepted; raw tool text is not rewritten before measuring.
if (!Array.isArray(input)) for (const [room, paths] of Object.entries(input) as [string, string[]][]) {
  for (const path of paths) {
    const calls = new Map<string, Record<string, unknown>>(); const seen = new Set<string>();
    for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
      const entry = JSON.parse(line); const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type === 'tool_use' && block.name?.endsWith('wait_for_messages')) calls.set(block.id, block.input);
        if (block.type !== 'tool_result' || seen.has(block.tool_use_id) || calls.get(block.tool_use_id)?.room !== room) continue;
        seen.add(block.tool_use_id);
        const text = typeof block.content === 'string' ? block.content : block.content?.filter((x: { type: string }) => x.type === 'text').map((x: { text: string }) => x.text).join('\n');
        if (!text || block.is_error) continue;
        const view = JSON.parse(text) as WaitView;
        if (Array.isArray(view.messages)) rows.push({ seat: path, room, view, original_bytes: Buffer.byteLength(text) });
      }
    }
  }
}
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
