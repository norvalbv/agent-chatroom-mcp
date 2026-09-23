/** Fixtures for the seat-launch tests (seat-prompt-argv.test.ts, codex-seat.test.ts, strays.test.ts): a recorded
 * `codex exec --json` stream, stub `codex` and `claude` binaries, a private hub and a stub OpenRouter endpoint.
 * Nothing here reaches a real model: the OpenRouter seat talks to the local stub, codex and claude are fakes. */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';

/** A real `codex exec --json` stream from codex-cli 0.155.0-alpha.16.3 on gpt-6-astra, recorded 2026-09-23: one thread,
 * two turns (`codex exec` answering ALPHA, then `codex exec resume` answering BETA), joined into one stream. The
 * second turn.completed is the thread's running total, not the turn's own: output_tokens 6, then 12. */
export const CODEX_TWO_TURN_JSONL = [
  '{"type":"thread.started","thread_id":"01a0d01e-2f3c-7a52-8a54-533f86a60e28"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ALPHA"}}',
  '{"type":"turn.completed","usage":{"input_tokens":19390,"cached_input_tokens":12160,"cache_write_input_tokens":0,"output_tokens":6,"reasoning_output_tokens":0}}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"BETA"}}',
  '{"type":"turn.completed","usage":{"input_tokens":44084,"cached_input_tokens":31360,"cache_write_input_tokens":0,"output_tokens":12,"reasoning_output_tokens":0}}',
].join('\n') + '\n';
/** What runCodex must write to <name>.usage.json for that stream: the last total, never the sum of the two. */
export const CODEX_TWO_TURN_SIDECAR = {
  steps: 2, prompt_tokens: 44084, completion_tokens: 12, cost: null,
  codex_usage: { input_tokens: 44084, cached_input_tokens: 31360, cache_write_input_tokens: 0, output_tokens: 12, reasoning_output_tokens: 0 },
};

/** Stub `codex`: records its argv, stdin and cwd in $FAKE_RECORD_DIR, writes the -o file, prints the recorded stream under --json. */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const argv = process.argv.slice(2), stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(path.join(process.env.FAKE_RECORD_DIR, 'codex-' + crypto.randomUUID() + '.json'), JSON.stringify({ argv, stdin, cwd: process.cwd() }));
const o = argv.indexOf('-o');
if (o >= 0) fs.writeFileSync(argv[o + 1], 'codex final text\\n');
process.stdout.write(argv.includes('--json') ? ${JSON.stringify(CODEX_TWO_TURN_JSONL)} : 'codex final text\\n');
`;
/** Stub claude: records like the codex stub and prints a result envelope. */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const argv = process.argv.slice(2), stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(path.join(process.env.FAKE_RECORD_DIR, 'claude-' + crypto.randomUUID() + '.json'), JSON.stringify({ argv, stdin, cwd: process.cwd() }));
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0, usage: {} }) + '\\n');
`;
/** Writes the stub codex and claude into dir; put dir first on PATH. */
export function writeFakeBins(dir: string) {
  for (const [name, body] of [['codex', FAKE_CODEX], ['claude', FAKE_CLAUDE]] as const) {
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
