/** Run: npx tsx scripts/delivery-cap-regression.ts
 * swarm-083203-kooz: one wait_for_messages returned the whole 66 KB backlog and overflowed the client's
 * tool-result limit. A single delivery (wait or read) is capped by rendered size and says how many remain;
 * the rest arrives on the next call, exactly once and in order. */
import assert from 'node:assert/strict';
import { Hub, type Message } from '../src/hub.js';
import { createSessionServer } from '../src/server.js';

let serial = 0;
function fixture(backlog: number, size = 600) {
  const h = new Hub();
  const name = `delivery-cap-${++serial}`;
  const { room, participant: a } = h.join(name, 'alice', 'test');
  const { participant: b } = h.join(name, 'bob', 'test');
  room.maxMessageChars = size + 100;
  const noise: Message[] = [];
  for (let i = 0; i < backlog; i++) noise.push(h.send(name, a.id, `n${i} ${'x'.repeat(size)}`, undefined, true));
  return { h, room, name, a, b, noise };
}
const chars = (h: Hub, room: any, ms: Message[]) => ms.reduce((n, m) => n + h.fmt(room, m).length, 0);
const cases: [string, () => Promise<void> | void][] = [];
function test(name: string, run: () => Promise<void> | void) { cases.push([name, run]); }

test('wait delivers a capped page, reports the rest, and pages the backlog exactly once', async () => {
  const f = fixture(200);
  const got: Message[] = [];
  const first = await f.h.wait(f.name, f.b.id, f.b.lastSeenSeq, 0);
  assert.ok(first.length > 0 && first.length < f.noise.length, `first wait is capped (got ${first.length})`);
  assert.ok(chars(f.h, f.room, first) <= Hub.DELIVERY_MAX_CHARS, 'page fits the char budget');
  const total = first.length + f.h.deliveryRemaining(f.b);
  assert.ok(f.h.deliveryRemaining(f.b) >= f.noise.length - first.length, 'remaining count is reported');
  got.push(...first);
  for (let i = 0; i < 50 && f.h.deliveryRemaining(f.b) > 0; i++) got.push(...(await f.h.wait(f.name, f.b.id, f.b.lastSeenSeq, 0)));
  assert.equal(got.length, total, 'remaining matched what later pages carried');
  assert.deepEqual(got.filter((m) => m.from.id === f.a.id).map((m) => m.id), f.noise.map((m) => m.id), 'every message once, in order');
  assert.equal(f.h.deliveryRemaining(f.b), 0);
  assert.equal((await f.h.wait(f.name, f.b.id, f.b.lastSeenSeq, 0)).length, 0);
});

test('an oversized single message is still delivered', async () => {
  const f = fixture(2, Hub.DELIVERY_MAX_CHARS + 100);
  const first = await f.h.wait(f.name, f.b.id, f.b.lastSeenSeq, 0);
  const page = await f.h.wait(f.name, f.b.id, f.b.lastSeenSeq, 0);
  const got = [...first, ...page].filter((m) => m.from.id === f.a.id);
  assert.ok(first.length >= 1 && page.length >= 1, 'each call carries at least one message');
  assert.equal(got[0].id, f.noise[0].id);
});

test('readAs is capped by the same budget and pages without loss', () => {
  const f = fixture(200);
  const got: Message[] = [];
  for (let i = 0; i < 50; i++) {
    const page = f.h.readAs(f.room, f.b, undefined, 500);
    assert.ok(chars(f.h, f.room, page) <= Hub.DELIVERY_MAX_CHARS, 'read page fits the char budget');
    if (!page.length) break;
    got.push(...page);
  }
  assert.deepEqual(got.filter((m) => m.from.id === f.a.id).map((m) => m.id), f.noise.map((m) => m.id));
});

test('MCP: wait_for_messages and read_messages stay small and say how many remain', async () => {
  const h = new Hub();
  const a = createSessionServer(h), b = createSessionServer(h);
  const call = async (session: any, tool: string, args: any) => {
    const out = await session.server._registeredTools[tool].handler(args, {});
    assert.ok(!out.isError, JSON.stringify(out));
    return { raw: out.content[0].text as string, json: JSON.parse(out.content[0].text) };
  };
  const room = 'delivery-cap-mcp';
  await call(a, 'join_room', { room, name: 'alice', agent: 'test' });
  await call(b, 'join_room', { room, name: 'bob', agent: 'test' });
  for (let i = 0; i < 150; i++) await call(a, 'send_message', { room, content: `m${i} ${'y'.repeat(600)}`, force: true });
  const w = await call(b, 'wait_for_messages', { room, timeout_ms: 0 });
  assert.ok(w.raw.length < 40_000, `wait result is ${w.raw.length} chars`);
  assert.ok(w.json.remaining > 0, 'wait result carries remaining');
  assert.match(w.json.hint ?? '', /remain/i, 'hint tells the seat to call again');
  const r = await call(b, 'read_messages', { room, since_seq: 0 });
  assert.ok(r.raw.length < 40_000, `read result is ${r.raw.length} chars`);
  assert.match(r.json.at(-1), /more message\(s\) remain.*since_seq=\d+/i, 'read ends with a paging line');
});

let failed = 0;
for (const [name, run] of cases) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`); }
}
console.log(`DELIVERY CAP: ${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
