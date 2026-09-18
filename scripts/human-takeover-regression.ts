/** Human-directed asks retain one responder across departure and timeout.
 * Run: npx tsx scripts/human-takeover-regression.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub } from '../src/hub.js';

function fixture(dataDir?: string) {
  const h = new Hub({ dataDir });
  const { room, participant: alice } = h.join('human-takeover', 'alice', 'test', {}, undefined, 'session-a');
  const { participant: bob } = h.join(room.name, 'bob', 'test', {}, undefined, 'session-b');
  const { participant: carol } = h.join(room.name, 'carol', 'test', {}, undefined, 'session-c');
  const { participant: human } = h.join(room.name, 'benji', 'human');
  const ask = h.send(room.name, human.id, '@alice Can you check progress?', undefined, true);
  const reply = (pid: string) => h.send(room.name, pid, 'I can check progress.', ask.id, true);
  return { h, room, alice, bob, carol, ask, reply };
}
const tests: [string, () => void][] = [
  ['replayed departure still authorizes successor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'human-takeover-'));
    try {
      const f = fixture(dir); f.h.leave(f.room.name, f.alice.id, true);
      const replay = new Hub({ dataDir: dir }); const room = replay.getRoom(f.room.name);
      const { participant: bob } = replay.join(room.name, 'bob', 'test', {}, f.bob.id, 'session-b');
      assert.equal(replay.attentionFocus(room, bob)?.id, f.ask.id);
      assert.doesNotThrow(() => replay.send(room.name, bob.id, 'I can check progress.', f.ask.id, true));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],
  ['takeover preserves question and greeting register caps', () => {
    for (const [text, cap] of [['@alice Can you check progress?', 900], ['@alice hello', 240]] as const) {
      const f = fixture(); f.ask.content = text; f.h.leave(f.room.name, f.alice.id, true);
      assert.equal(f.h.attentionFocus(f.room, f.bob)?.id, f.ask.id);
      assert.throws(() => f.h.send(f.room.name, f.bob.id, 'x'.repeat(cap + 1), f.ask.id, true), /capped at/);
      assert.doesNotThrow(() => f.h.send(f.room.name, f.bob.id, 'x'.repeat(cap), f.ask.id, true));
    }
  }],
  ['explicit all remains answerable by every agent', () => {
    const f = fixture(); f.ask.content = '@all hello';
    assert.doesNotThrow(() => f.reply(f.alice.id));
    assert.doesNotThrow(() => f.reply(f.bob.id));
    assert.doesNotThrow(() => f.reply(f.carol.id));
  }],
  ['departure hands reply authorization to current nominee', () => {
    const f = fixture(); f.h.leave(f.room.name, f.alice.id, true);
    assert.equal(f.h.attentionFocus(f.room, f.bob)?.id, f.ask.id);
    assert.equal(f.h.responderFor(f.room, f.ask, f.bob.id).mine, true);
    assert.doesNotThrow(() => f.reply(f.bob.id));
    assert.equal(f.h.isAnswered(f.room, f.ask), true);
  }],
  ['60-second targeted timeout permits nominee reply', () => {
    const f = fixture(); f.ask.ts = new Date(Date.now() - 61_000).toISOString();
    assert.equal(f.h.attentionFocus(f.room, f.bob)?.id, f.ask.id);
    assert.doesNotThrow(() => f.reply(f.bob.id));
    assert.equal(f.h.isAnswered(f.room, f.ask), true);
  }],
  ['live addressee remains exclusive before targeted timeout', () => {
    const f = fixture(); assert.throws(() => f.reply(f.bob.id), /not you/);
    assert.doesNotThrow(() => f.reply(f.alice.id));
  }],
  ['takeover remains exclusive against third party and old addressee', () => {
    const f = fixture(); f.ask.ts = new Date(Date.now() - 61_000).toISOString();
    assert.equal(f.h.responderFor(f.room, f.ask, f.bob.id).mine, true);
    assert.throws(() => f.reply(f.carol.id), /not you/);
    assert.throws(() => f.reply(f.alice.id), /not you/);
    assert.doesNotThrow(() => f.reply(f.bob.id));
  }],
];
let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e}`); }
}
console.log(`${tests.length - failed}/${tests.length} human takeover cases passed`);
process.exitCode = failed ? 1 : 0;
