/** Offline contract tests for tasks/bench-printf-format-2 (the scaled sibling of bench-printf-format). Run: node --import tsx scripts/oracle-tasks-printf.test.ts */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';

const task = resolve('tasks/bench-printf-format-2');

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
  const root = mkdtempSync(join(tmpdir(), 'printf2-task-'));
  try {
    const dir = join(root, 'stub');
    cpSync(join(task, 'public'), dir, { recursive: true });
    const red = hidden(dir);
    assert.equal(red.status, 1, red.stderr);
    const result = JSON.parse(red.stdout);
    assert.equal(result.score, 0);
    assert.ok(result.oracle_results.length >= 3000);
    assert.ok(result.oracle_results.every((r: { exit_code: number }) => r.exit_code === 1));
    const scored = await scoreTask(task, dir);
    assert.equal(scored.passed, false);
    assert.equal(scored.reason, 'task_fail');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the README-derived reference passes every hidden case, deterministically', async () => {
  const root = mkdtempSync(join(tmpdir(), 'printf2-task-'));
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
  const root = mkdtempSync(join(tmpdir(), 'printf2-task-'));
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
    assert.ok(result.oracle_results.filter((r: { exit_code: number }) => r.exit_code === 1).length > 1500);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shelling out to the real printf scores 0 even through an absolute path and an obfuscated import', { skip: !existsSync('/usr/bin/printf') }, () => {
  const root = mkdtempSync(join(tmpdir(), 'printf2-task-'));
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

test('the hidden cases contain the traps the band depends on (exact-binary digits, ties, negative zero, # flags, wrap, star)', () => {
  const text = readFileSync(join(task, 'oracle/cases.json'), 'utf8');
  for (const needle of ['9.9999999999999995e-08', '"fmt":"%.0f"', '"n":"-0"', '"fmt":"%#.0e"', '"fmt":"%#o"', '"fmt":"%hhd"', '"fmt":"%*d"', '"fmt":"%.*d"', '"fmt":"%lu"', '"fmt":"%hhu"']) {
    assert.ok(text.includes(needle), `missing trap: ${needle}`);
  }
});

function failedCount(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'printf2-task-'));
  try {
    const dir = workspace(root, 'variant', source);
    const result = JSON.parse(hidden(dir).stdout);
    return (result.oracle_results as { exit_code: number }[]).filter((r) => r.exit_code !== 0).length;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('each new rule of the README is load-bearing: dropping any one of them fails hidden cases', () => {
  const src = readFileSync(join(task, 'fixtures/correct/format.ts'), 'utf8');
  const variant = (from: string, to: string) => { assert.ok(src.includes(from), from); return src.replace(from, to); };
  assert.ok(failedCount(variant("BigInt.asIntN(bits, BigInt(arg as number | bigint))", "BigInt(arg as number | bigint)")) > 100, 'no signed reduction');
  assert.ok(failedCount(variant("BigInt.asUintN(bits, BigInt(arg as number | bigint))", "BigInt(arg as number | bigint)")) > 100, 'no unsigned reduction');
  assert.ok(failedCount(variant("if (fmt[i] === 'h') { i++; bits = 16; if (fmt[i] === 'h') { i++; bits = 8; } }", "if (fmt[i] === 'h') { i++; bits = 16; if (fmt[i] === 'h') i++; }")) > 50, 'hh treated as h');
  assert.ok(failedCount(variant("if (w < 0) minus = true;", "")) > 20, 'negative star width');
  assert.ok(failedCount(variant("prec = p < 0 ? null : p;", "prec = Math.abs(p);")) > 20, 'negative star precision');
  assert.ok(failedCount(variant("bits = 64; if (fmt[i] === 'l') i++;", "bits = 32; if (fmt[i] === 'l') i++;")) > 100, 'l treated as int');
});
