/** Seat-owned hubd commands refuse --always before starting a listener, for every provider; no persistent hub starts. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

const { CHATROOM_SEAT_KEY: _key, CHATROOM_HEARTBEAT_URL: _url, ...operator } = process.env;
const run = (args: string[], seat = true, heartbeat?: string) => new Promise<{ code: number | null; output: string }>((done, reject) => {
  const child = spawn(process.execPath, [resolve('dist/hubd.js'), ...args], {
    env: { ...operator, ...(seat ? { CHATROOM_SEAT_KEY: 'codex-shaped-seat-key' } : {}), ...(heartbeat ? { CHATROOM_HEARTBEAT_URL: heartbeat } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', d => output += d);
  child.stderr.on('data', d => output += d);
  const timer = setTimeout(() => { child.kill(); reject(new Error('guard did not exit')); }, 10_000);
  child.on('error', reject);
  child.on('close', code => { clearTimeout(timer); done({code, output}); });
});
// Invalid port ensures even the parent build cannot launch a persistent hub during the red check.
for (const args of [['--always', '--port', '0'], ['--port', '0', '--always']]) {
  const denied = await run(args);
  assert.equal(denied.code, 2);
  assert.match(denied.output, /seat-guard: refused: hubd --always/);
}
for (const [args, seat] of [[['--always', '--port', '0'], false], [['--port', '0'], true]] as const) {
  const ordinary = await run([...args], seat);
  assert.equal(ordinary.code, 2);
  assert.match(ordinary.output, /--port <number>/);
  assert.doesNotMatch(ordinary.output, /seat-guard/);
}
const receipts: any[] = [];
const hub = createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => { receipts.push(JSON.parse(body)); res.end('{}'); });
});
await new Promise<void>(done => hub.listen(0, '127.0.0.1', done));
try {
  const denied = await run(['--always', '--port', '0'], true, `http://127.0.0.1:${(hub.address() as AddressInfo).port}/heartbeat`);
  assert.equal(denied.code, 2);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].seat_key, 'codex-shaped-seat-key');
  assert.equal(receipts[0].tool, 'seat-guard');
  assert.match(receipts[0].detail, /refused: hubd --always/);
} finally { await new Promise<void>(done => hub.close(() => done())); }
const deadHub = await run(['--always', '--port', '0'], true, 'http://127.0.0.1:9/heartbeat');
assert.equal(deadHub.code, 2);
assert.match(deadHub.output, /seat-guard/);
console.log('HUBD SEAT GUARD OK (2 argv orders, operator/no-always controls, heartbeat and offline refusal; no hub launched)');
