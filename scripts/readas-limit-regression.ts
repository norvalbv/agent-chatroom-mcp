/** Run: npx tsx scripts/readas-limit-regression.ts
 * readAs returned limit+1 messages: the focused ask plus `limit` queued ones. The ask counts toward the limit,
 * and paging still carries the whole queue exactly once behind it. */
import assert from 'node:assert/strict';
import { Hub, type Message } from '../src/hub.js';

const h = new Hub();
const name = 'readas-limit';
const { room, participant: a } = h.join(name, 'alice', 'test');
const { participant: b } = h.join(name, 'bob', 'test');
const { participant: c } = h.join(name, 'carol', 'test');
const noise: Message[] = [];
for (let i = 0; i < 25; i++) noise.push(h.send(name, c.id, `noise-${i}`, undefined, true));
const ask = h.send(name, a.id, '@bob inspect this', undefined, true);

const first = h.readAs(room, b, undefined, 10);
assert.equal(first[0].id, ask.id, 'the ask still leads');
assert.equal(first.length, 10, `limit 10 returns 10 messages, not ${first.length}`);
assert.equal(h.readAs(room, b, undefined, 1).length, 1, 'limit 1 returns the ask alone');

const got = first.slice(1);
for (let i = 0; i < 20; i++) {
  const page = h.readAs(room, b, undefined, 10);
  assert.ok(page.length <= 10, `page of ${page.length} exceeds the limit`);
  got.push(...page.filter((m) => m.id !== ask.id));
  if (page.length === 1) break;
}
assert.deepEqual(got.filter((m) => m.from.id === c.id).map((m) => m.id), noise.map((m) => m.id), 'queue paged exactly once');
console.log('READAS LIMIT OK');
