/** Same scripted brief against two compiled hubs: answer a pending peer on an already-settled thread. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const { Hub } = await import(pathToFileURL(resolve(root, 'dist/hub.js')).href);
const { createSessionServer } = await import(pathToFileURL(resolve(root, 'dist/server.js')).href);
const hub = new Hub();
const sessions = Object.fromEntries(['alice', 'bob', 'carol'].map(name => [name, createSessionServer(hub)]));
const room = 'compound-reply-bench';
const metrics: Record<string, { calls: number; response_bytes: number; refusals: number }> = {};
const seen: string[] = [];
async function call(who: string, tool: string, args: Record<string, unknown>) {
  const result = await sessions[who].server._registeredTools[tool].handler({ room, ...args }, {});
  const text = result.content.filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n');
  const m = metrics[who] ??= { calls: 0, response_bytes: 0, refusals: 0 };
  m.calls++; m.response_bytes += Buffer.byteLength(text); if (result.isError) m.refusals++;
  if (who === 'bob') seen.push(text);
  return { result, text, data: result.isError ? undefined : JSON.parse(text) };
}
for (const name of Object.keys(sessions)) await call(name, 'join_room', { name, agent: 'script', expected_participants: 0 });
const old = (await call('alice', 'send_message', { content: '@bob first question', force: true })).data;
await call('bob', 'wait_for_messages', { timeout_ms: 0 });
await call('bob', 'send_message', { content: 'first answer', reply_to: old.id });
await call('carol', 'send_message', { content: '@bob verify the result', force: true });
await call('bob', 'wait_for_messages', { timeout_ms: 0 });
await call('alice', 'send_message', { content: 'UNREAD_EVIDENCE_739', force: true });
const before = { ...metrics.bob };
const request = { content: '@carol verified', reply_to: old.id };
const attempt = await call('bob', 'send_message', request);
if (attempt.result.isError) assert.ok(!(await call('bob', 'send_message', { ...request, force: true })).result.isError);
const delta = Object.fromEntries(Object.keys(before).map(key => [key, metrics.bob[key as keyof typeof before] - before[key as keyof typeof before]]));
await call('bob', 'wait_for_messages', { timeout_ms: 0 });
await call('bob', 'wait_for_messages', { timeout_ms: 0 });
const state = hub.getRoom(room);
const bob = [...state.participants.values()].find((p: any) => p.name === 'bob')!;
assert.equal(hub.addressedBy(state, bob).length, 0, 'pending ask answered');
assert.equal(state.messages.filter((m: any) => m.content === request.content).length, 1, 'one compound answer');
assert.equal(seen.filter(text => text.includes('UNREAD_EVIDENCE_739')).length, 1, 'concurrent evidence delivered exactly once');
console.log(JSON.stringify({ brief: 'Answer a pending peer on an already-settled thread; preserve concurrent evidence exactly once',
  hub_sha256: createHash('sha256').update(readFileSync(resolve(root, 'dist/hub.js'))).digest('hex'),
  oracle: { pending_asks: 0, compound_answers: 1, evidence_deliveries: 1 }, target_send: delta, seats: metrics,
  provider_tokens: null, token_note: 'Scripted MCP replay has no model/token usage; live benchmark accounts for provider tokens separately.' }, null, 2));
await Promise.all(Object.values(sessions).map((s: any) => s.server.close()));
