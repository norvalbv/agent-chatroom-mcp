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
  // A command killed at the time limit is reported as a timeout, not as a failed assertion (bugs.md 8: 4 of 138 commands
  // were SIGKILLed at a fixed 120 s under load, with nothing to tell them from real failures), and the limit can be raised.
  const tlines = [];
  const slow = { name: 'slow under load', command: process.execPath, args: ['-e', 'setTimeout(()=>{},700)'] };
  const tcode = runCommands([slow, { name: 'real failure', command: process.execPath, args: ['-e', 'process.exit(5)'] }], { cwd: dir, timeout: 150, log: line => tlines.push(line) });
  const tsum = tlines.join('\n');
  assert.match(tsum, /\[offline\] FAILED slow under load: TIMED OUT, killed at the 0\.15 s limit \(no assertion failed\)/, 'a timeout is named as one, with the limit, in the FAILED shape the pool parser reads');
  assert.match(tsum, /\[offline\] FAILED 2 of 2 commands:\n  - slow under load: TIMED OUT[^\n]*\n  - real failure: exit 5/, 'one summary lists both, each with its reason');
  assert.match(tsum, /\[offline:time\] 1 of the 2 failed by TIMING OUT[\s\S]*CHATROOM_TEST_TIMEOUT_MS/, 'the summary says how many were timeouts and how to raise the limit');
  assert.equal(tcode, 5, 'a real failure decides the exit code');
  assert.equal(runCommands([slow], { cwd: dir, timeout: 150, log: () => {} }), 124, 'timeouts alone exit 124, the conventional timeout code');
  process.env.CHATROOM_TEST_TIMEOUT_MS = '5000';
  assert.equal(runCommands([slow], { cwd: dir, log: () => {} }), 0, 'CHATROOM_TEST_TIMEOUT_MS sets the limit when the caller passes none');
  process.env.CHATROOM_TEST_TIMEOUT_MS = '150';
  assert.equal(runCommands([slow], { cwd: dir, log: () => {} }), 124);
  delete process.env.CHATROOM_TEST_TIMEOUT_MS;
  // telemetry: how long each command took, and the slowest, so the next limit is set from numbers
  const out = [];
  const realLog = console.log; console.log = (...a) => out.push(a.join(' '));
  try { runCommands([{ name: 'quick', command: process.execPath, args: ['-e', ''] }, slow], { cwd: dir, timeout: 5000, log: () => {} }); } finally { console.log = realLog; }
  assert.match(out.join('\n'), /\[offline:time\] quick took \d+\.\d s/);
  assert.match(out.join('\n'), /\[offline:time\] slowest: slow under load \d+\.\d s/);
  // scripts/pool-suite-view.ts reads every stdout line "[offline] <name>" as a command starting: only the two commands are
  assert.deepEqual(out.join('\n').split('\n').filter(l => /^\[offline\] /.test(l) && !/^\[offline\] OK /.test(l)), ['[offline] quick', '[offline] slow under load']);
  console.log('OFFLINE RUNNER SELF-TEST OK');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
