/** Real seat wrapper: runs dist/openrouter.js as a child, then extracts the room conclusion into answer.txt. */
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const args = process.argv.slice(2);
const flag = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const mcpUrl = flag('--mcp-url', process.env.CHATROOM_MCP_URL ?? '');
const cwd = resolve(flag('--cwd', process.cwd()));
const port = new URL(mcpUrl).port;
const hub = process.env.BENCH_HUB_ENTRY ?? '';
const room = 'benchmark';
const started = Date.now();
const log = [];
const seatArgs = [process.env.BENCH_SEAT_ENTRY ?? 'dist/openrouter.js', '-p', readFileSync(join(cwd, 'brief.txt'), 'utf8'), '--mcp-url', mcpUrl, '--cwd', cwd, '--model', 'stealth/union-alpha', '--no-shell', '--max-minutes', flag('--max-minutes', '8')];
const child = spawn(process.execPath, seatArgs, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => log.push(String(d)));
child.stderr.on('data', d => log.push(String(d)));
const exit = await new Promise(ok => child.on('exit', (code, signal) => ok({ code, signal })));
// Extract the conclusion from the hub's persisted log for this arm.
const dataDir = process.env.CHATROOM_DATA_DIR;
let answer = '';
const logPath = dataDir ? join(dataDir, 'benchmark.jsonl') : '';
if (logPath && existsSync(logPath)) {
  const events = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const conclusion = [...events].reverse().find(e => e.type === 'state' && e.state === 'concluded' && e.conclusion?.text);
  if (conclusion) answer = conclusion.conclusion.text;
  if (!answer) {
    const lastChat = [...events].reverse().find(e => e.type === 'message' && e.msg?.kind === 'chat' && typeof e.msg?.text === 'string');
    if (lastChat) answer = lastChat.msg.text;
  }
}
writeFileSync(join(cwd, 'answer.txt'), answer);
writeFileSync(join(cwd, 'seat-report.json'), JSON.stringify({ model: 'stealth/union-alpha', mcp_url: mcpUrl, hub_entry: hub, seat_pid: child.pid, exit_code: exit.code, exit_signal: exit.signal, duration_ms: Date.now() - started, log_chars: log.join('').length, answer_chars: answer.length, finished_at: new Date().toISOString() }, null, 2));
process.exit(0);
