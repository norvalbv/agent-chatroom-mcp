import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { seatChildEnv, SEAT_ENV_EXCLUSIONS } from '../src/env.js';

// Dynamic import keeps the test-only commit executable against the base: missing implementation is a test failure.
const impl = () => import('../src/respawn.js');
test('launcher registers exact immediate predecessor before returning respawn note', async () => {
  const { registerRespawn } = await impl();
  const calls: any[] = [];
  const note = await registerRespawn('http://localhost:8888', 'room / one', 'seat-r1', 'seat-r2', 'secret', async (url: any, init: any) => {
    calls.push([url, init]);
    return new Response(JSON.stringify({ replacementToken: 'one-use-proof' }), { status: 200 });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'http://localhost:8888/rooms/room%20%2F%20one/replacements');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['x-chatroom-launcher-token'], 'secret');
  assert.deepEqual(JSON.parse(calls[0][1].body), { replacement_of: 'seat-r1', name: 'seat-r2' });
  assert.match(note, /You replace seat-r1/);
  assert.match(note, /replacement_token/);
  assert.match(note, /one-use-proof/);
  assert.doesNotMatch(note, /secret/);
});
test('launcher refuses an uncredentialed respawn without making HTTP request', async () => {
  const { registerRespawn } = await impl();
  let called = false;
  await assert.rejects(registerRespawn('http://localhost:8888', 'room', 'a', 'b', undefined, async () => { called = true; return new Response('{}'); }), /CHATROOM_LAUNCHER_TOKEN/);
  assert.equal(called, false);
});
test('launcher aborts on denied or unavailable registration rather than silently respawning', async () => {
  const { registerRespawn } = await impl();
  await assert.rejects(registerRespawn('http://localhost:8888', 'room', 'a', 'b', 'secret', async () => new Response('denied', { status: 403 })), /403/);
  await assert.rejects(registerRespawn('http://localhost:8888', 'room', 'a', 'b', 'secret', async () => { throw Error('offline'); }), /offline/);
});
test('launcher control credential is excluded from seat environments and dotenv reloads', () => {
  const env = { CHATROOM_LAUNCHER_TOKEN: 'secret', OTHER: 'yes' };
  assert.equal(seatChildEnv(env).CHATROOM_LAUNCHER_TOKEN, undefined);
  assert.ok(SEAT_ENV_EXCLUSIONS.includes('CHATROOM_LAUNCHER_TOKEN'));
  assert.equal(env.CHATROOM_LAUNCHER_TOKEN, 'secret');
});
test('all provider respawns await registration before spawning and track immediate predecessor', async () => {
  // the chain lives in respawn.ts (respawnChain) so a replaced attempt's usage is kept; swarm.ts hands it registerRespawn
  const swarm = readFileSync(new URL('../src/swarm.ts', import.meta.url), 'utf8')
  assert.match(swarm, /register: \(previousName, nm, reason\) => registerRespawn\(URL_, room, previousName, nm,/)
  const { respawnChain } = await import('../src/respawn.js')
  const events: string[] = []
  let releaseRegistration!: () => void
  const registered = new Promise<void>((r) => (releaseRegistration = r))
  const room = { state: 'open', participants: [{ name: 'w', agent: 'claude', role: 'worker', active: false }], board: {} }
  const chain = respawnChain<string>({
    name: 'w', maxAttempts: 2, stop: () => false, room: async () => room, exitCode: () => 1,
    register: async (previous, name) => { events.push(`register ${previous}->${name}`); if (name === 'w-r1') await registered; return '' },
    run: async (name) => { events.push(`run ${name}`); return name },
  })
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(events, ['run w', 'register w->w-r1'], 'the successor is not spawned while its registration is pending')
  releaseRegistration()
  await chain
  assert.deepEqual(events, ['run w', 'register w->w-r1', 'run w-r1', 'register w-r1->w-r2', 'run w-r2'], 'each registration names the immediate predecessor')
})


test('launcher rejects success response without a one-use join proof', async () => {
  const { registerRespawn } = await impl();
  await assert.rejects(registerRespawn('http://localhost:8888', 'room', 'a', 'b', 'secret', async () => new Response('{}')), /proof|token/i);
});
