/**
 * Regression: recruit rooms inherit the requester's run prefix.
 *
 * The launcher's result artifact gathers rooms by name.startsWith(runPrefix)
 * (src/swarm.ts:471) and the per-run recruit caps group by runPrefix
 * (src/spawner.ts:172, src/hub.ts:388), but spawner.request used to ensureRoom()
 * the LITERAL requested new_room name. A seat-requested break-out named e.g.
 * "brk-foo" therefore silently missed result.json rooms[] and escaped the
 * per-run recruit cap. This test asserts the ensured/created room name SHARES
 * the requester's run prefix.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Spawner } from '../src/spawner.js';

/** The run-prefix shape a launcher run uses: swarm-<6 digits>[-<4 chars>]-… */
const RUN_PREFIX = /^(swarm-[0-9]{6}(?:-[a-z0-9]{4})?)-/;

function fixture(fn: (s: Spawner, dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'spawner-run-prefix-'));
  try {
    const s = new Spawner({ logDir: dir, dryRun: true, mcpUrl: 'http://127.0.0.1:0/mcp', defaultCwd: dir });
    s.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: () => {}, liveAgents: () => 0 });
    fn(s, dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const brief = 'Finish the recruit-room run-prefix wiring so break-out reports land in the run artifact.';

test('new_room without a run prefix inherits the requester room run prefix', () => {
  fixture((s) => {
    const ensured: string[] = [];
    s.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: (room) => ensured.push(room), announce: () => {}, liveAgents: () => 0 });
    const [rec] = s.request({ room: 'swarm-010513-crup-recruit-prefix', requestedBy: 'requester', brief, newRoom: 'brk-foo', count: 1, name: 'probe' });
    assert.equal(ensured.length, 1);
    assert.match(ensured[0], RUN_PREFIX); // ensured/created room shares the requester's run prefix
    assert.equal(ensured[0], 'swarm-010513-crup-brk-foo');
    assert.equal(rec.room, 'swarm-010513-crup-brk-foo'); // recruits join the prefixed room
    assert.match(readFileSync(rec.log, 'utf8'), /swarm-010513-crup-brk-foo/); // prompt names the prefixed room
  });
});

test('new_room is left untouched when the requester room has no run prefix', () => {
  fixture((s) => {
    const ensured: string[] = [];
    s.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: (room) => ensured.push(room), announce: () => {}, liveAgents: () => 0 });
    const [rec] = s.request({ room: 'recruit-live', requestedBy: 'requester', brief, newRoom: 'brk-foo', count: 1, name: 'probe' });
    assert.deepEqual(ensured, ['brk-foo']);
    assert.equal(rec.room, 'brk-foo');
  });
});

test('an already-prefixed new_room is not double-prefixed', () => {
  fixture((s) => {
    const ensured: string[] = [];
    s.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: (room) => ensured.push(room), announce: () => {}, liveAgents: () => 0 });
    s.request({ room: 'swarm-010513-crup-leads', requestedBy: 'requester', brief, newRoom: 'swarm-010513-crup-brk-usage', count: 1, name: 'probe' });
    assert.deepEqual(ensured, ['swarm-010513-crup-brk-usage']);
  });
});
