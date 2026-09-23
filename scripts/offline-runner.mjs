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
  'baseline-freeze-guard-regression.ts',
  'ak-select.test.ts',
  'paper-account-regime.test.ts',
  'paper-number-audit.test.ts',
  'bench-ak.test.ts',
  'bench-build-oracle-audit.test.ts',
  'bench-build-task.test.ts',
  'bench-build-ledger-scale.test.ts',
  'bench-build-grid.test.ts',
  'bench-build-report.test.ts',
  'bench-build-report-audit.test.ts',
  'bench-build-e2e-audit.test.ts',
  'bench-grid.test.ts',
  'bench-hub-no-recruit-regression.ts',
  'bench-orphan-regression.ts',
  'bench-rq1.test.ts',
  'stamp-adjudication-replay.test.ts',
  'bench-build.test.ts',
  'bench-build-audit.test.ts',
  'bench-build-oracle-audit.test.ts',
  'bench-build-runner.test.ts',
  'generator-file-regex-regression.ts',
  'board-expiry-regression.ts',
  'board-manifest-regression.ts',
  'board-transport-regression.ts',
  'challenge-session-regression.ts',
  'claude-lean-flags-regression.ts',
  'claude-usage-regression.ts',
  'complementary-fix-task.test.ts',
  'concluded-room-hint-regression.ts',
  'confirmatory-grid.test.ts',
  'consolidator-spawn-regression.ts',
  'conv-forensics.test.ts',
  'departed-mentions.test.ts',
  'electorate-regression.ts',
  'handoff-regression.ts',
  'heartbeat-regression.ts',
  'handoff-task-fixture.test.ts',
  'hold-until-actionable-regression.ts',
  'kick-vote-regression.ts',
  'human-answering.test.ts',
  'layer-rules-400-task.test.ts',
  'layer-views-task.test.ts',
  'leave-post-conclusion-regression.ts',
  'liveness-regression.ts',
  'idlewaits-actionable-regression.ts',
  'lease-lock-tasks.test.ts',
  'shelf-quiet-task.test.ts',
  'stamp-helpers-task.test.ts',
  'mention-mentions.test.ts',
  'openrouter-cache-regression.ts',
  'oracle-tasks-printf.test.ts',
  'jensen-task.test.ts',
  'oracle-tasks-printf2.test.ts',
  'oracle-tasks-spec-audit.test.ts',
  'oracle-tasks.test.ts',
  'paper-fig-data.test.ts',
  'paper-fig-tables.test.ts',
  'paper-rq1-armk.test.ts',
  'paper-rq1-confirmatory.test.ts',
  'paper-rq1-family.test.ts',
  'paper-rq1-table.test.ts',
  'paper-rq1-tex.test.ts',
  'regression-replay.ts',
  'recruit-prefix-regression.ts',
  'replace-regression.ts',
  'route-auth-regression.ts',
  'refusal-telemetry.ts',
  'shelf-lang-tasks.test.ts',
  'arrow-task.test.ts',
  'quiet-guidance-regression.ts',
  'quiet-receipts.ts',
  'quill-task.test.ts',
  'quorum-supermajority-regression.ts',
  'read-digest-regression.ts',
  'reply-metrics-analyzer.test.ts',
  'reply-metrics.test.ts',
  'respawn-regression.ts',
  'result-fleet-compat.ts',
  'result-fleet-regression.ts',
  'reviewer-assignment-regression.ts',
  'rq1-stats.test.ts',
  'rq1-usage-budget-regression.ts',
  'seat-env-regression.ts',
  'seat-git-config-regression.ts',
  'gleam-task.test.ts',
  'half-round-task.test.ts',
  'sched-trace-plus-task.test.ts',
  'sched-trace-task.test.ts',
  'seat-search-regression.ts',
  'spawner-run-prefix.test.ts',
  'stamp-task.test.ts',
  'suite-registry.test.ts',
  'stamp2-task.test.ts',
  'strtod-task.test.ts',
  'stats-electorate-regression.ts',
  'stats-integration-regression.ts',
  'stats-regression.ts',
  'telemetry-usage-regression.ts',
  'test-inbox-handover.ts',
  'tool-surface-regression.ts',
  'trim-checkpoint-regression.ts',
  'uncited-challenge-regression.ts',
  'verify-verdict-regression.ts',
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const commands = [
    { name: 'runner self-tests', command: process.execPath, args: ['scripts/offline-runner.test.mjs'] },
    // Fleet CLI fixtures consume dist: compile every run rather than testing stale output.
    { name: 'build', command: process.execPath, args: ['node_modules/typescript/bin/tsc'] },
    ...offlineScripts.map(file => ({ name: file, command: process.execPath, args: [...(file === 'seat-env-regression.ts' || file === 'claude-lean-flags-regression.ts' ? ['--experimental-vm-modules'] : []), '--import', 'tsx', `scripts/${file}`] })),
  ];
  process.exitCode = runCommands(commands, { cwd });
}
