import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommands } from './offline-runner.mjs';

const dir = mkdtempSync(join(tmpdir(), 'offline-runner-test-'));
try {
  // One failing (e.g. load-flaky) script must not hide later results: every command runs, all failures are listed.
  const marker = join(dir, 'still-runs');
  const lines = [];
  const result = runCommands([
    { name: 'intentional failure', command: process.execPath, args: ['-e', 'process.exit(7)'] },
    { name: 'later command', command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`] },
    { name: 'second failure', command: process.execPath, args: ['-e', 'process.exit(3)'] },
  ], { cwd: dir, log: line => lines.push(line) });
  assert.equal(result, 7, 'preserves the first nonzero exit code');
  assert.equal(existsSync(marker), true, 'keeps running after a failure');
  const summary = lines.join('\n').slice(lines.join('\n').lastIndexOf('[offline] FAILED 2 of 3'));
  assert.match(summary, /^\[offline\] FAILED 2 of 3/, 'reports the failure count at the end');
  assert.match(summary, /intentional failure: exit 7/, 'summary names the first failure');
  assert.match(summary, /second failure: exit 3/, 'summary names the later failure');
  assert.equal(runCommands([{ name: 'success', command: process.execPath, args: ['-e', 'process.exit(0)'] }], { cwd: dir }), 0);
  assert.notEqual(runCommands([{ name: 'missing executable', command: join(dir, 'missing'), args: [] }], { cwd: dir }), 0);
  assert.notEqual(runCommands([{ name: 'timeout', command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }], { cwd: dir, timeout: 100 }), 0);
  console.log('OFFLINE RUNNER SELF-TEST OK');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
