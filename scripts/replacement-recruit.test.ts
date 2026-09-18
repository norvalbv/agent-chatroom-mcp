import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Spawner } from '../src/spawner.js';

function fixture(fn: (s: Spawner, dir: string) => void, register?: (room: string, old: string, name: string) => string) {
  const dir = mkdtempSync(join(tmpdir(), 'replacement-recruit-'));
  try {
    const s = new Spawner({ logDir: dir, dryRun: true, mcpUrl: 'http://127.0.0.1:18489/mcp', defaultCwd: dir });
    s.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: () => {}, liveAgents: () => 0, registerReplacement: register });
    fn(s, dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const req = { room: 'replacement', requestedBy: 'requester', brief: 'Finish the outstanding replacement wiring task.', replacing: 'departed', name: 'fresh' };
test('recruit registers actual name before recording launch and puts proof in rendered prompt', () => {
  let s_: Spawner;
  fixture((s) => {
    s_ = s;
    const [rec] = s.request(req);
    const prompt = readFileSync(rec.log, 'utf8');
    assert.match(prompt, /replacement_token="one-use-proof"/);
    assert.match(prompt, /You replace departed/);
    assert.doesNotMatch(prompt, /\{\{REPLACING\}\}/);
  }, (room, old, name) => {
    assert.equal(s_.agents.length, 0);
    assert.deepEqual([room, old, name], ['replacement', 'departed', 'fresh']);
    return 'one-use-proof';
  });
});
test('replacement registration failure or missing hook fails closed before launch', () => {
  fixture((s) => { assert.throws(() => s.request(req), /unavailable/); assert.equal(s.agents.length, 0); });
  fixture((s) => { assert.throws(() => s.request(req), /denied/); assert.equal(s.agents.length, 0); }, () => { throw Error('denied'); });
  fixture((s) => { assert.throws(() => s.request(req), /no join proof/); assert.equal(s.agents.length, 0); }, () => '');
});
test('replacement cannot spawn a group or change rooms', () => {
  fixture((s) => {
    for (const extra of [{ count: 2 }, { newRoom: 'other' }, { replacing: '' }]) assert.throws(() => s.request({ ...req, ...extra }), /one recruit/);
    assert.equal(s.agents.length, 0);
  }, () => { assert.fail('must validate before registration'); });
});
