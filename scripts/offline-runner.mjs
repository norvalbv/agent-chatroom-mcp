/** Explicit, reviewed offline suite. Do not glob: several scripts launch live seats. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export function runCommands(commands, { cwd, timeout = 120_000 } = {}) {
  for (const { name, command, args } of commands) {
    console.log(`\n[offline] ${name}`);
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout, killSignal: 'SIGKILL' });
    if (result.error || result.signal || result.status !== 0) {
      console.error(`[offline] FAILED ${name}: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}`);
      return result.status || 1;
    }
  }
  console.log(`[offline] OK (${commands.length} commands)`);
  return 0;
}

export const offlineScripts = [
  'archive-regression.ts',
  'attention-gate-regression.ts',
  'board-expiry-regression.ts',
  'board-manifest-regression.ts',
  'board-transport-regression.ts',
  'challenge-session-regression.ts',
  'departed-mentions.test.ts',
  'electorate-regression.ts',
  'handoff-regression.ts',
  'handoff-task-fixture.test.ts',
  'human-answering.test.ts',
  'mention-mentions.test.ts',
  'regression-replay.ts',
  'refusal-telemetry.ts',
  'quiet-receipts.ts',
  'reply-metrics-analyzer.test.ts',
  'reply-metrics.test.ts',
  'respawn-regression.ts',
  'result-fleet-compat.ts',
  'result-fleet-regression.ts',
  'seat-env-regression.ts',
  'seat-search-regression.ts',
  'stats-electorate-regression.ts',
  'stats-integration-regression.ts',
  'stats-regression.ts',
  'test-inbox-handover.ts',
  'uncited-challenge-regression.ts',
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const commands = [
    { name: 'runner self-tests', command: process.execPath, args: ['scripts/offline-runner.test.mjs'] },
    // Fleet CLI fixtures consume dist: compile every run rather than testing stale output.
    { name: 'build', command: process.execPath, args: ['node_modules/typescript/bin/tsc'] },
    ...offlineScripts.map(file => ({ name: file, command: process.execPath, args: [...(file === 'seat-env-regression.ts' ? ['--experimental-vm-modules'] : []), '--import', 'tsx', `scripts/${file}`] })),
  ];
  process.exitCode = runCommands(commands, { cwd });
}
