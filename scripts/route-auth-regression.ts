/**
 * Route auth regression (safety R6(2), controller-owned authority):
 * the human controller POST routes must FAIL CLOSED when CHATROOM_HUMAN_TOKEN is unset,
 * unless the operator explicitly opts into insecure loopback-only operation
 * (CHATROOM_INSECURE_LOCAL=1 with HOST on loopback). Heartbeat stays token-free seat liveness.
 * Style: scripts/replacement-route.test.ts — spawns an isolated hub per arm, asserts HTTP statuses.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withHub(extra: Record<string, string>, fn: (base: string) => Promise<void>) {
  const port = 19000 + Math.floor(Math.random() * 10000);
  const dir = mkdtempSync(join(tmpdir(), 'route-auth-'));
  // Scrub ambient controller env so each arm is exact; re-add only the arm's variables.
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const key of Object.keys(env)) if (key.startsWith('CHATROOM_')) delete env[key];
  Object.assign(env, { PORT: String(port), CHATROOM_DATA_DIR: dir }, extra);
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'], { env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(ready, 'isolated hub started');
    await fn(base);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>(r => child.exitCode !== null ? r() : child.once('exit', () => r()));
    rmSync(dir, { recursive: true, force: true });
  }
}
const post = (base: string, path: string, token?: string, body: unknown = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-chatroom-token': token } : {}) }, body: JSON.stringify(body) });
const config = async (base: string) => (await (await fetch(`${base}/config`)).json()) as { human_token_required: boolean };

test('token unset, no opt-in: controller POST refused; /config says required; heartbeat still answers', () => withHub({}, async base => {
  const close = await post(base, '/rooms/x/close', undefined, { name: 'benji', reason: 'x' });
  assert.ok([401, 403].includes(close.status), `close must be refused, got ${close.status}`);
  const policy = await post(base, '/policy', 'invented', { agent: 'any', model: 'any' });
  assert.ok([401, 403].includes(policy.status), `any token attempt is refused too, got ${policy.status}`);
  assert.equal((await config(base)).human_token_required, true, '/config must not claim the controller is open');
  const hb = await post(base, '/rooms/x/heartbeat', undefined, { participant_id: 'p_1', tool: 't', step: 1 });
  assert.ok(![401, 403].includes(hb.status), `heartbeat is seat liveness, never controller-gated (got ${hb.status})`);
}));

test('token unset + CHATROOM_INSECURE_LOCAL=1 on loopback: controller works; /config reports open; heartbeat is 200', () => withHub({ CHATROOM_INSECURE_LOCAL: '1' }, async base => {
  const created = await post(base, '/rooms/auth-optin/create', undefined, { topic: 'opt-in arm', require_challenge: false });
  assert.ok([200, 201].includes(created.status), `create should pass under the opt-in, got ${created.status}`);
  const msgRes = await post(base, '/rooms/auth-optin/messages', undefined, { name: 'benji', content: 'dashboard works token-free locally' });
  assert.equal(msgRes.status, 200, 'human message allowed under opt-in');
  // Participant ids are never listed over HTTP (identity-is-the-connection), but the message carries the sender id.
  const benjiId = ((await msgRes.json()) as { from: { id: string } }).from.id;
  assert.ok(benjiId, 'human participant id from the message envelope');
  const hb = await post(base, '/rooms/auth-optin/heartbeat', undefined, { participant_id: benjiId, tool: 'read_file', step: 3 });
  assert.equal(hb.status, 200, 'heartbeat answers for a real participant without any token');
  assert.equal((await config(base)).human_token_required, false, '/config reflects the combined gate');
  const closed = await post(base, '/rooms/auth-optin/close', undefined, { name: 'benji', reason: 'section done' });
  assert.equal(closed.status, 200, 'close allowed under opt-in');
}));

test('opt-in without loopback HOST still refuses: CHATROOM_INSECURE_LOCAL=1 is not a remote backdoor', () => withHub({ CHATROOM_INSECURE_LOCAL: '1', HOST: '0.0.0.0' }, async base => {
  const close = await post(base, '/rooms/x/close', undefined, { name: 'benji', reason: 'x' });
  assert.ok([401, 403].includes(close.status), `close must be refused on a non-loopback bind, got ${close.status}`);
  assert.equal((await config(base)).human_token_required, true);
}));

test('token set: exact header required; right header passes; /config reports required; heartbeat token-free', () => withHub({ CHATROOM_HUMAN_TOKEN: 'route-auth-secret' }, async base => {
  assert.equal((await post(base, '/rooms/x/close')).status, 401, 'absent header refused');
  assert.equal((await post(base, '/rooms/x/close', 'wrong')).status, 401, 'wrong header refused');
  const created = await post(base, '/rooms/auth-tok/create', 'route-auth-secret', { topic: 'token arm' });
  assert.ok([200, 201].includes(created.status), `right header passes, got ${created.status}`);
  assert.equal((await config(base)).human_token_required, true);
  const hb = await post(base, '/rooms/auth-tok/heartbeat', undefined, { participant_id: 'p_1' });
  assert.ok(![401, 403].includes(hb.status), `heartbeat must not demand the human token (got ${hb.status})`);
}));
