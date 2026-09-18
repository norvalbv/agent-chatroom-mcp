import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withHub(token: string, fn: (base: string) => Promise<void>) {
  const port = 19000 + Math.floor(Math.random() * 10000);
  const dir = mkdtempSync(join(tmpdir(), 'replacement-route-'));
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
    env: { ...process.env, PORT: String(port), CHATROOM_DATA_DIR: dir, CHATROOM_LAUNCHER_TOKEN: token }, stdio: 'ignore',
  });
  const base = `http://localhost:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(ready, 'isolated hub started');
    await fn(base);
  } finally { child.kill('SIGTERM'); await new Promise<void>(r => child.exitCode !== null ? r() : child.once('exit', () => r())); rmSync(dir, { recursive: true, force: true }); }
}
const request = (base: string, token?: string, body: unknown = { replacement_of: 'a', name: 'b' }) => fetch(`${base}/rooms/test/replacements`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-chatroom-launcher-token': token } : {}) }, body: JSON.stringify(body) });
test('replacement route is disabled without configured launcher authority', () => withHub('', async base => {
  assert.equal((await request(base)).status, 503);
  assert.equal((await request(base, 'invented')).status, 503);
}));
test('replacement route rejects absent/wrong token, validates payload with correct token', () => withHub('controller-secret', async base => {
  assert.equal((await request(base)).status, 401);
  assert.equal((await request(base, 'wrong')).status, 401);
  assert.equal((await request(base, 'controller-secret', { replacement_of: {}, name: 'b' })).status, 400);
  assert.equal((await request(base, 'controller-secret', { replacement_of: 'a', name: '' })).status, 400);
}));
