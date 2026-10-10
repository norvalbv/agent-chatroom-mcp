/** Naming a human is not answering them: npx tsx scripts/human-mentions-regression.ts
 * Before, any agent message that named a human anywhere ("the rule from benji", "draft/ask-benji-graph") was read as a
 * reply to that human's latest message: it was refused when the human had addressed someone else, capped at 240/900
 * characters, recorded with reply_to, and marked the human answered. 72 of 616 agent messages recorded as replies to a
 * human across 259 room logs named the human only in passing (humans-answered-once-by-hub-enforcement, 2026-10-10:
 * "Not fixed"). Now a message answers a human by reply_to, @name, or the name in address position ("Thanks benji,",
 * "Benji: ..."). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hub } from '../src/hub.js';

function fixture(ask = '@alice Can you check progress?') {
  const h = new Hub({});
  const { room, participant: alice } = h.join('human-mentions', 'alice', 'test', {}, undefined, 'session-a');
  const { participant: bob } = h.join(room.name, 'bob', 'test', {}, undefined, 'session-b');
  const { participant: carol } = h.join(room.name, 'carol', 'test', {}, undefined, 'session-c');
  const { participant: human } = h.join(room.name, 'benji', 'human');
  const q = h.send(room.name, human.id, ask, undefined, true);
  return { h, room, alice, bob, carol, q };
}

test('a message to another seat that names the human in passing is not a reply to them', () => {
  const f = fixture();
  const m = f.h.send(f.room.name, f.bob.id, '@carol the recruit rule from benji says opus or sonnet only; see draft/ask-benji-graph', undefined, true);
  assert.notEqual(m.replyTo, f.q.id, 'not recorded as a reply to the human');
  assert.equal(f.h.isAnswered(f.room, f.q), false, "the human's ask is still open");
});

test('a long working message that names the human is not capped to their register', () => {
  const f = fixture('hello team');
  assert.doesNotThrow(() => f.h.send(f.room.name, f.bob.id, `@carol per benji's earlier note, here is the full plan: ${'x'.repeat(1200)}`, undefined, true));
});

test('naming a human after someone answered them is not refused as a second answer', () => {
  const f = fixture('hello team');
  f.h.send(f.room.name, f.alice.id, 'Hi benji!', undefined, true);
  assert.equal(f.h.isAnswered(f.room, f.q), true);
  assert.doesNotThrow(() => f.h.send(f.room.name, f.bob.id, '@carol I relayed this to benji already in the summary', undefined, true));
});

test('replies in address position, by @name, or by reply_to still answer', () => {
  for (const text of ['Thanks benji, checking progress now.', 'Benji: progress is fine.', '@benji progress is fine.', 'Understood, Benji. On it.', 'Done. Benji, the answer is 42.']) {
    const f = fixture('hello team');
    f.h.send(f.room.name, f.alice.id, text, undefined, true);
    assert.equal(f.h.isAnswered(f.room, f.q), true, `answered by "${text}"`);
  }
  const f = fixture('hello team');
  f.h.send(f.room.name, f.alice.id, 'Progress is fine.', f.q.id, true);
  assert.equal(f.h.isAnswered(f.room, f.q), true, 'answered by reply_to');
});

test('a name opening a later sentence without punctuation after it is still a mention, not an answer', () => {
  const f = fixture('hello team');
  f.h.send(f.room.name, f.alice.id, '@bob checked. Benji explicitly wants opus seats only.', undefined, true);
  assert.equal(f.h.isAnswered(f.room, f.q), false);
});

test('a seat the human did not address is still refused when it answers them by name', () => {
  const f = fixture();
  assert.throws(() => f.h.send(f.room.name, f.bob.id, '@benji I can check progress.', undefined, true), /not you/);
});
