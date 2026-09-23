/** Fixtures for the seat-launch tests (seat-prompt-argv.test.ts): a stub `claude` binary, a private hub and a stub
 * OpenRouter endpoint. Nothing here reaches a real model: the OpenRouter seat talks to the local stub, claude is a fake. */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';

/** Stub claude: records its argv, stdin and cwd in $FAKE_RECORD_DIR and prints a result envelope. */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const argv = process.argv.slice(2), stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(path.join(process.env.FAKE_RECORD_DIR, 'claude-' + crypto.randomUUID() + '.json'), JSON.stringify({ argv, stdin, cwd: process.cwd() }));
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0, usage: {} }) + '\\n');
`;
/** Writes the stub claude into dir; put dir first on PATH. */
export function writeFakeBins(dir: string) {
  for (const [name, body] of [['claude', FAKE_CLAUDE]] as const) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
}

export async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return port;
}

/** A private in-memory hub from this checkout's dist on a free port: no recruits, loopback only. Stop it by its pid. */
export async function startHub(logDir: string, cwd: string): Promise<{ hub: ChildProcess; url: string; port: number }> {
  const port = await freePort();
  const hub = spawn(process.execPath, [join(process.cwd(), 'dist', 'index.js')], {
    cwd, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CHATROOM_INSECURE_LOCAL: '1', CHATROOM_NO_RECRUIT: '1', CHATROOM_LOG_DIR: logDir, CHATROOM_DATA_DIR: '' },
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url + '/rooms')).ok) return { hub, url, port }; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  hub.kill();
  throw new Error('private hub did not start');
}

export interface StubBody { messages: { role: string; content?: string }[] }
/** OpenAI-compatible stub for OPENROUTER_BASE_URL: calls onRequest (while the seat waits on it), then answers with a
 * final message and no tool call, so a seat that has not joined a room finishes at once. */
export async function startStub(onRequest: (body: StubBody) => void = () => {}): Promise<{ url: string; bodies: StubBody[]; close: () => Promise<void> }> {
  const bodies: StubBody[] = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = JSON.parse(raw) as StubBody;
      bodies.push(body);
      try { onRequest(body); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0 } }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, bodies, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}
