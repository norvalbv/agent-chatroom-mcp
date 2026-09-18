import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommands } from './offline-runner.mjs';

const dir = mkdtempSync(join(tmpdir(), 'offline-runner-test-'));
try {
  const marker = join(dir, 'must-not-run');
  const result = runCommands([
    { name: 'intentional failure', command: process.execPath, args: ['-e', 'process.exit(7)'] },
    { name: 'must not run', command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`] },
  ], { cwd: dir });
  assert.equal(result, 7, 'preserves child nonzero exit code');
  assert.equal(existsSync(marker), false, 'stops before later commands');
  assert.equal(runCommands([{ name: 'success', command: process.execPath, args: ['-e', 'process.exit(0)'] }], { cwd: dir }), 0);
  assert.notEqual(runCommands([{ name: 'missing executable', command: join(dir, 'missing'), args: [] }], { cwd: dir }), 0);
  assert.notEqual(runCommands([{ name: 'timeout', command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }], { cwd: dir, timeout: 100 }), 0);
  console.log('OFFLINE RUNNER SELF-TEST OK');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
