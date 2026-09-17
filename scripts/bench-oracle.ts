/** Minimal task/scorer contract for the harness. oracle-2 owns the full fixtures + oracle-tasks regression. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
type OracleConfig = { kind: string; expected: string; distractors?: string[] };
export function loadTask(taskDir: string) {
  const config = JSON.parse(readFileSync(join(taskDir, 'oracle', 'oracle.json'), 'utf8')) as OracleConfig;
  const task_id = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8')).task_id as string;
  return { task_id, oracle: { kind: config.kind }, config };
}
export async function scoreTask(taskDir: string, workspace: string) {
  const config = JSON.parse(readFileSync(join(taskDir, 'oracle', 'oracle.json'), 'utf8')) as OracleConfig;
  if (config.kind === 'inclusive-dates') {
    const scorerPath = resolve(taskDir, 'oracle', 'score.ts');
    const command = 'node --import tsx oracle/score.ts <workspace>';
    const run = spawnSync(process.execPath, ['--import', 'tsx', scorerPath, workspace], { encoding: 'utf8', timeout: 10000 });
    const oracle = { kind: config.kind, command, exit_code: run.status };
    if (run.error || (run.status !== 0 && run.status !== 1)) {
      return { passed: false, reason: 'infra', oracle, oracle_results: [] };
    }
    try {
      const scored = JSON.parse(run.stdout) as { score: number; oracle_results: { name: string; exit_code: number }[] };
      if ((scored.score !== 0 && scored.score !== 1) || !Array.isArray(scored.oracle_results) || !scored.oracle_results.length ||
          !scored.oracle_results.every(r => typeof r.name === 'string' && (r.exit_code === 0 || r.exit_code === 1)) ||
          (scored.score === 1) !== (run.status === 0) ||
          (scored.score === 1) !== scored.oracle_results.every(r => r.exit_code === 0)) {
        throw Error('Invalid inclusive-dates oracle result');
      }
      return { passed: scored.score === 1, reason: scored.score === 1 ? 'oracle-pass' : 'oracle-fail', oracle, oracle_results: scored.oracle_results };
    } catch {
      return { passed: false, reason: 'parse-failure', oracle, oracle_results: [] };
    }
  }
  const scorerPath = resolve(dirname(fileURLToPath(import.meta.url)), 'score-fact-check.ts');
  const command = `node --import tsx ${basename(scorerPath)} <workspace>/answer.txt oracle/oracle.json`;
  const answerPath = join(workspace, 'answer.txt');
  if (!existsSync(answerPath)) return { passed: false, reason: 'parse-failure', oracle: { kind: config.kind, command, exit_code: null } };
  const run = spawnSync(process.execPath, ['--import', 'tsx', scorerPath, answerPath, join(taskDir, 'oracle', 'oracle.json')], { encoding: 'utf8', timeout: 10000 });
  if (run.error || run.status === null || run.status > 2) return { passed: false, reason: 'infra', oracle: { kind: config.kind, command, exit_code: null } };
  let scored: { score: number };
  try { scored = JSON.parse(run.stdout) as { score: number }; }
  catch { return { passed: false, reason: 'parse-failure', oracle: { kind: config.kind, command, exit_code: run.status } }; }
  return { passed: scored.score === 1, reason: scored.score === 1 ? 'oracle-pass' : 'oracle-fail', oracle: { kind: config.kind, command, exit_code: run.status } };
}
