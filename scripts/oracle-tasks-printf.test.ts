/** Offline contract tests for tasks/bench-printf-format. Run: node --import tsx scripts/oracle-tasks-printf.test.ts */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';

const task = resolve('tasks/bench-printf-format');

function workspace(root: string, name: string, source?: string) {
  const dir = join(root, name);
  cpSync(join(task, 'public'), dir, { recursive: true });
  assert.equal(existsSync(join(dir, 'oracle')), false, 'oracle/ must never reach a seat workspace');
  assert.equal(existsSync(join(dir, 'fixtures')), false, 'fixtures/ must never reach a seat workspace');
  writeFileSync(join(dir, 'format.ts'), source ?? readFileSync(join(task, 'fixtures/correct/format.ts'), 'utf8'));
  return dir;
}
function hidden(dir: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', join(task, 'oracle/score.ts'), dir], { encoding: 'utf8', timeout: 60000 });
}

test('task loads as a private-tests kind and the public stub fails every hidden case', async () => {
  assert.equal(loadTask(task).oracle.kind, 'printf-format');
  const root = mkdtempSync(join(tmpdir(), 'printf-task-'));
  try {
    const dir = join(root, 'stub');
    cpSync(join(task, 'public'), dir, { recursive: true });
    const red = hidden(dir);
    assert.equal(red.status, 1, red.stderr);
    const result = JSON.parse(red.stdout);
    assert.equal(result.score, 0);
    assert.ok(result.oracle_results.length >= 600);
    assert.ok(result.oracle_results.every((r: { exit_code: number }) => r.exit_code === 1));
    const scored = await scoreTask(task, dir);
    assert.equal(scored.passed, false);
    assert.equal(scored.reason, 'task_fail');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the README-derived reference passes every hidden case, deterministically', async () => {
  const root = mkdtempSync(join(tmpdir(), 'printf-task-'));
  try {
    const dir = workspace(root, 'correct');
    const a = hidden(dir);
    const b = hidden(dir);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(a.stdout, b.stdout);
    assert.equal(JSON.parse(a.stdout).score, 1);
    assert.equal((await scoreTask(task, dir)).reason, 'task_pass');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a toFixed/toPrecision shortcut fails hidden cases (exact-binary rounding and round-half-even are required)', () => {
  const root = mkdtempSync(join(tmpdir(), 'printf-task-'));
  try {
    const shortcut = `export function format(fmt: string, ...args: any[]): string {
      let i = 0;
      return fmt.replace(/%([-+ 0#]*)(\\d*)(?:\\.(\\d*))?([diouxXeEfFgGsc%])/g, (_m, _fl, w, p, c) => {
        if (c === '%') return '%';
        const a = args[i++];
        let s: string;
        if (c === 'f' || c === 'F') s = (a as number).toFixed(p === undefined ? 6 : Number(p || 0));
        else if (c === 'd' || c === 'i') s = String(a);
        else s = String(a);
        return s.padStart(Number(w || 0), ' ');
      });
    }\n`;
    const dir = workspace(root, 'shortcut', shortcut);
    const run = hidden(dir);
    assert.equal(run.status, 1);
    const result = JSON.parse(run.stdout);
    assert.equal(result.score, 0);
    assert.ok(result.oracle_results.filter((r: { exit_code: number }) => r.exit_code === 1).length > 300);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shelling out to the real printf scores 0 even through an absolute path and an obfuscated import', { skip: !existsSync('/usr/bin/printf') }, () => {
  const root = mkdtempSync(join(tmpdir(), 'printf-task-'));
  try {
    const cheat = `const cp = (process as any).getBuiltinModule('node:child_' + 'process');
export function format(f: string, ...a: any[]): string {
  return cp.execFileSync('/usr/bin/printf', [f, ...a.map(String)]).toString();
}\n`;
    const dir = workspace(root, 'cheat', cheat);
    const run = hidden(dir);
    assert.equal(run.status, 1);
    const result = JSON.parse(run.stdout);
    assert.equal(result.score, 0);
    assert.equal(result.oracle_results.filter((r: { exit_code: number }) => r.exit_code === 0).length, 0, 'the patched child_process must stop every call, not only some');
    const literal = workspace(root, 'cheat-literal', `import { execSync } from 'node:child_process';\nexport function format(f: string) { return execSync('true').toString(); }\n`);
    const literalRun = hidden(literal);
    assert.equal(JSON.parse(literalRun.stdout).oracle_results[0].name, 'artifact-load');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the hidden cases contain the traps the band depends on (exact-binary digits, ties, negative zero, # flags)', () => {
  const text = readFileSync(join(task, 'oracle/score.ts'), 'utf8');
  for (const needle of ['9.9999999999999995e-08', '"fmt": "%.0f"', '"n": "-0"', '"fmt": "%#.0e"', '"fmt": "%#o"']) {
    assert.ok(text.includes(needle), `missing trap: ${needle}`);
  }
});
