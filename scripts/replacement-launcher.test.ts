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
test('all provider respawns await registration before spawning and track immediate predecessor', () => {
  const swarm = readFileSync(new URL('../src/swarm.ts', import.meta.url), 'utf8');
  assert.match(swarm, /await registerRespawn\(URL_, room, previousName, nm/);
  assert.match(swarm, /out = await mk\(nm, note\);\s*previousName = nm;/);
  assert.match(swarm, /let previousName = name;/);
});

test('launcher rejects success response without a one-use join proof', async () => {
  const { registerRespawn } = await impl();
  await assert.rejects(registerRespawn('http://localhost:8888', 'room', 'a', 'b', 'secret', async () => new Response('{}')), /proof|token/i);
});
