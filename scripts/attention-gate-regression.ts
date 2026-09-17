/** RE-TARGET hub-carries-what-it-knows. Run: npx tsx scripts/attention-gate-regression.ts */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub, type Message } from '../src/hub.js';

let serial = 0;
function fixture(dataDir?: string) {
  const h = new Hub({ dataDir });
  const name = `attention-${++serial}`;
  const { room, participant: a } = h.join(name, 'alice', 'test', {}, undefined, 'session-a');
  const { participant: b } = h.join(name, 'bob', 'test', {}, undefined, 'session-b');
  const { participant: c } = h.join(name, 'carol', 'test', {}, undefined, 'session-c');
  const send = (p: typeof a, text: string, reply?: string, quiet = false) => h.send(name, p.id, text, reply, true, quiet);
  const ask = (p = a, text = '@bob inspect this') => send(p, text);
  const wait = () => h.wait(name, b.id, b.lastSeenSeq, 0);
  return { h, room, name, a, b, c, send, ask, wait };
}
const ids = (ms: Message[]) => ms.map(m => m.id);
const cases: [string, () => Promise<void> | void][] = [];
function test(name: string, run: () => Promise<void> | void) { cases.push([name, run]); }

test('unrelated chat preserves directed debt', () => {
  const f = fixture(); const q = f.ask(); f.send(f.b, 'unrelated update');
  assert.deepEqual(ids(f.h.addressedBy(f.room, f.b)), [q.id]);
});
test('reply_to discharges only targeted ask; @-back does not double-discharge', () => {
  const f = fixture(); const q1 = f.ask(); const q2 = f.ask(); const q3 = f.ask(f.c);
  f.send(f.b, '@carol answer', q2.id);
  assert.deepEqual(ids(f.h.addressedBy(f.room, f.b)), [q1.id, q3.id]);
});
test('@-back discharges oldest outstanding ask per named sender', () => {
  const f = fixture(); f.ask(); const q2 = f.ask(); f.ask(f.c);
  f.send(f.b, '@alice @carol answers');
  assert.deepEqual(ids(f.h.addressedBy(f.room, f.b)), [q2.id]);
});
test('wait repeats only ask despite before/after noise; no recurring exception', async () => {
  const f = fixture(); f.send(f.c, 'before'); const q = f.ask(); f.send(f.c, 'after');
  for (let i = 0; i < 3; i++) {
    f.h.answerBeforeWaiting(f.room, f.b, f.b.lastSeenSeq);
    assert.deepEqual(ids(await f.wait()), [q.id]);
  }
});
test('bare pass before focus delivery never declines unseen asks', () => {
  const f = fixture(); const q1 = f.ask(); const q2 = f.ask(); f.h.pass(f.name, f.b.id);
  assert.deepEqual(ids(f.h.addressedBy(f.room, f.b)), [q1.id, q2.id]);
});
test('bare pass declines delivered focus only, not next unseen ask', async () => {
  const f = fixture(); const q1 = f.ask(); const q2 = f.ask();
  assert.deepEqual(ids(await f.wait()), [q1.id]); f.h.pass(f.name, f.b.id);
  assert.deepEqual(ids(f.h.addressedBy(f.room, f.b)), [q2.id]);
  f.h.pass(f.name, f.b.id); // no second focus delivery yet
  assert.deepEqual(ids(f.h.addressedBy(f.room, f.b)), [q2.id]);
  assert.deepEqual(ids(await f.wait()), [q2.id]); f.h.pass(f.name, f.b.id);
  assert.equal(f.h.addressedBy(f.room, f.b).length, 0);
});
test('more than ten asks remain debt', () => {
  const f = fixture(); const asks = Array.from({length: 14}, () => f.ask());
  assert.deepEqual(ids(f.h.addressedBy(f.room, f.b)), ids(asks));
});
test('reply releases >200 before/after messages exactly once', async () => {
  const f = fixture(); const noise: Message[] = [];
  for (let i = 0; i < 120; i++) noise.push(f.send(f.c, `before-${i}`));
  const q = f.ask();
  for (let i = 0; i < 230; i++) noise.push(f.send(f.c, `after-${i}`));
  assert.deepEqual(ids(await f.wait()), [q.id]);
  f.send(f.b, 'answer', q.id);
  const got = await f.wait();
  assert.deepEqual(ids(got.filter(m => m.from.id === f.c.id)), ids(noise));
  assert.equal((await f.wait()).length, 0);
});
test('targeted non-force reply bypasses stale gate and preserves arriving noise', async () => {
  const f = fixture(); const q = f.ask(); await f.wait(); const noise = f.send(f.c, 'new noise');
  f.h.send(f.name, f.b.id, 'answer', q.id);
  assert.ok(ids(await f.wait()).includes(noise.id));
});
test('unrelated stale refusal returns only focused ask and keeps debt', () => {
  const f = fixture(); const q = f.ask(); f.send(f.c, 'not-for-focused-delivery');
  let error: any;
  try { f.h.send(f.name, f.b.id, 'unrelated update'); } catch (e) { error = e; }
  assert.ok(error, 'stale unrelated post should be refused');
  assert.ok(JSON.stringify(error).includes(q.content));
  assert.ok(!JSON.stringify(error).includes('not-for-focused-delivery'));
  assert.deepEqual(ids(f.h.addressedBy(f.room, f.b)), [q.id]);
});
test('readAs repeats focus and subsequently pages held backlog without loss', async () => {
  const f = fixture(); const noise: Message[] = [];
  for (let i = 0; i < 220; i++) noise.push(f.send(f.c, `noise-${i}`));
  const q = f.ask();
  assert.deepEqual(ids(f.h.readAs(f.room, f.b, 0, 500)), [q.id]);
  assert.deepEqual(ids(f.h.readAs(f.room, f.b, undefined, 1)), [q.id]);
  f.send(f.b, 'answer', q.id);
  const got: Message[] = [];
  for (let i = 0; i < 20; i++) { const batch = f.h.readAs(f.room, f.b, undefined, 31); if (!batch.length) break; got.push(...batch); }
  assert.deepEqual(ids(got.filter(m => m.from.id === f.c.id)), ids(noise));
});
test('nominated human preempts agent ask without clearing it or leaking to peer', async () => {
  const f = fixture(); const q = f.ask(); await f.wait();
  const {participant: human} = f.h.join(f.name, 'human', 'human');
  const humanAsk = f.send(human, '@bob human priority');
  assert.deepEqual(ids(await f.wait()), [humanAsk.id]);
  assert.ok(!ids(await f.h.wait(f.name, f.c.id, f.c.lastSeenSeq, 0)).includes(humanAsk.id));
  f.send(f.b, 'Yes.', humanAsk.id);
  assert.deepEqual(ids(await f.wait()), [q.id]);
});
test('passing newer human focus retains older agent ask', async () => {
  const f = fixture(); const q = f.ask(); await f.wait();
  const {participant: human} = f.h.join(f.name, 'human', 'human');
  const humanAsk = f.send(human, '@bob another human question');
  assert.deepEqual(ids(await f.wait()), [humanAsk.id]); f.h.pass(f.name, f.b.id);
  assert.deepEqual(ids(await f.wait()), [q.id]);
});
test('quiet bystander body not parked by gate; explicit pull then surface is once', async () => {
  const f = fixture(); const q = f.ask();
  const quiet = f.send(f.a, '@carol quiet-only-body', undefined, true);
  assert.deepEqual(ids(await f.wait()), [q.id]);
  f.send(f.b, 'answer', q.id);
  assert.ok(!ids(await f.wait()).includes(quiet.id));
  assert.ok(ids(f.h.readAs(f.room, f.b, 0, 500)).includes(quiet.id), 'quiet remains explicitly readable');
  f.h.surfaceThread(f.room, quiet.id, 'test surface');
  assert.ok(!ids(await f.wait()).includes(quiet.id), 'already pulled body must not redeliver');
});
test('unread quiet body surfaces after gate without being lost', async () => {
  const f = fixture(); const q = f.ask(); const quiet = f.send(f.a, '@carol private-push-only', undefined, true);
  await f.wait(); f.send(f.b, 'answer', q.id); await f.wait();
  f.h.surfaceThread(f.room, quiet.id, 'test surface');
  assert.ok(ids(await f.wait()).includes(quiet.id));
  assert.ok(!ids(await f.wait()).includes(quiet.id));
});
test('reclaim and disk replay preserve focus, decline and backlog', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'attention-gate-test-'));
  try {
    const f = fixture(dir); const noise = f.send(f.c, 'held through replay'); const q1 = f.ask(); const q2 = f.ask();
    await f.wait(); f.h.pass(f.name, f.b.id); await f.wait();
    const h = new Hub({dataDir: dir});
    const {room, participant: b} = h.join(f.name, 'bob', 'test', {}, f.b.id, 'reclaimed-session');
    assert.deepEqual(ids(h.addressedBy(room, b)), [q2.id]);
    assert.deepEqual(ids(await h.wait(f.name, b.id, b.lastSeenSeq, 0)), [q2.id]);
    h.pass(f.name, b.id);
    assert.ok(ids(await h.wait(f.name, b.id, b.lastSeenSeq, 0)).includes(noise.id));
    assert.ok(!ids(h.addressedBy(room, b)).includes(q1.id));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
for (const state of ['closed', 'concluded'] as const) test(`${state} bypass releases backlog instead of focus`, async () => {
  const f = fixture(); const q = f.ask(); const noise = f.send(f.c, 'closure noise'); await f.wait(); f.room.state = state;
  const got = await f.wait(); assert.ok(ids(got).includes(noise.id)); assert.notDeepEqual(ids(got), [q.id]);
});

let failed = 0;
for (const [name, run] of cases) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`); }
}
console.log(`ATTENTION GATE: ${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
