/** Regression tests for bench-ignore-rules and bench-doc-audit (swarm-140131-j6yf, sonnet-6).
 * Run: node --import tsx scripts/oracle-tasks-spec-audit.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTask, scoreTask } from './bench-oracle.ts';

const ignoreTask = resolve('tasks/bench-ignore-rules');
const auditTask = resolve('tasks/bench-doc-audit');
const AUDIT_FILES = ['slugify', 'chunk', 'median', 'formatBytes', 'parseBool', 'daysBetween', 'dedupe', 'wrapText'];

function workspace(taskDir: string) {
  const dir = mkdtempSync(join(tmpdir(), 'oracle-spec-audit-'));
  cpSync(join(taskDir, 'public'), dir, { recursive: true });
  assert.equal(existsSync(join(dir, 'oracle')), false);
  assert.equal(existsSync(join(dir, 'fixtures')), false);
  return dir;
}
const cleanup = (dir: string) => rmSync(dir, { recursive: true, force: true });

test('ignore-rules: kind dispatches to the generic private-test scorer', () => {
  assert.equal(loadTask(ignoreTask).oracle.kind, 'ignore-rules');
});

test('ignore-rules: stub fails, reference passes, missing artifact is parse_failure', async () => {
  const dir = workspace(ignoreTask);
  try {
    const stub = await scoreTask(ignoreTask, dir);
    assert.equal(stub.passed, false);
    assert.equal(stub.reason, 'task_fail');
    cpSync(join(ignoreTask, 'fixtures/correct/ignore.ts'), join(dir, 'ignore.ts'));
    const good = await scoreTask(ignoreTask, dir);
    assert.equal(good.passed, true);
    assert.equal(JSON.stringify(good), JSON.stringify(await scoreTask(ignoreTask, dir)));
    rmSync(join(dir, 'ignore.ts'));
    assert.equal((await scoreTask(ignoreTask, dir)).reason, 'parse_failure');
  } finally { cleanup(dir); }
});

test('ignore-rules: constant and substring shortcuts do not pass', async () => {
  const dir = workspace(ignoreTask);
  try {
    for (const body of [
      'export const isIgnored = () => true;',
      'export const isIgnored = () => false;',
      'export const isIgnored = (rules: string, path: string) => rules.split("\\n").some((r) => r && path.includes(r));',
    ]) {
      writeFileSync(join(dir, 'ignore.ts'), body);
      const scored = await scoreTask(ignoreTask, dir);
      assert.equal(scored.passed, false, body);
      assert.equal(scored.reason, 'task_fail');
    }
  } finally { cleanup(dir); }
});

test('ignore-rules: delegating to the real git is rejected (no program reachable through PATH)', async () => {
  const dir = workspace(ignoreTask);
  try {
    writeFileSync(join(dir, 'ignore.ts'), `import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
export function isIgnored(rules: string, path: string): boolean {
  const repo = mkdtempSync(join(tmpdir(), 'cheat-'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, '.gitignore'), rules + '\\n');
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), '');
  return spawnSync('git', ['check-ignore', '-q', '--no-index', '--', path], { cwd: repo }).status === 0;
}
`);
    const scored = await scoreTask(ignoreTask, dir);
    assert.equal(scored.passed, false);
    assert.equal(scored.reason, 'task_fail');
  } finally { cleanup(dir); }
});

test('ignore-rules: every case has an expected value, mixed outcomes, and the reference agrees offline', async () => {
  const { cases } = await import(pathToFileURL(join(ignoreTask, 'oracle/cases.ts')).href);
  const { isIgnored } = await import(pathToFileURL(join(ignoreTask, 'fixtures/correct/ignore.ts')).href);
  const expected = JSON.parse(readFileSync(join(ignoreTask, 'oracle/expected.json'), 'utf8')) as Record<string, boolean>;
  assert.deepEqual(Object.keys(expected).sort(), cases.map((c: { name: string }) => c.name).sort());
  const values = Object.values(expected);
  assert.ok(values.some(Boolean) && values.some((v) => !v), 'expected values must not be constant');
  for (const c of cases) assert.equal(isIgnored(c.rules, c.path), expected[c.name], c.name);
});

test('ignore-rules: expected values still agree with real git check-ignore', { skip: spawnSync('git', ['--version']).status !== 0 }, () => {
  const run = spawnSync(process.execPath, ['--import', 'tsx', join(ignoreTask, 'oracle/verify-against-git.ts')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('doc-audit: buggy start fails every function; fixture passes; kind dispatches', async () => {
  assert.equal(loadTask(auditTask).oracle.kind, 'doc-audit');
  const dir = workspace(auditTask);
  try {
    const red = (await scoreTask(auditTask, dir)) as { passed: boolean; reason: string; oracle_results: { name: string; exit_code: number }[] };
    assert.equal(red.passed, false);
    assert.equal(red.reason, 'task_fail');
    assert.deepEqual(red.oracle_results.map((r) => r.name), AUDIT_FILES);
    assert.ok(red.oracle_results.every((r) => r.exit_code === 1));
    cpSync(join(auditTask, 'fixtures/correct/lib'), join(dir, 'lib'), { recursive: true });
    const green = await scoreTask(auditTask, dir);
    assert.equal(green.passed, true);
    assert.equal(green.reason, 'task_pass');
  } finally { cleanup(dir); }
});

test('doc-audit: each function is scored independently, so one missed discrepancy fails the task', async () => {
  for (const file of AUDIT_FILES) {
    const dir = workspace(auditTask);
    try {
      cpSync(join(auditTask, 'fixtures/correct/lib'), join(dir, 'lib'), { recursive: true });
      cpSync(join(auditTask, 'public/lib', `${file}.ts`), join(dir, 'lib', `${file}.ts`));
      const scored = (await scoreTask(auditTask, dir)) as { passed: boolean; oracle_results: { name: string; exit_code: number }[] };
      assert.equal(scored.passed, false, `${file} left buggy must fail`);
      assert.deepEqual(scored.oracle_results.filter((r) => r.exit_code === 1).map((r) => r.name), [file]);
    } finally { cleanup(dir); }
  }
});

test('doc-audit: partial fixes seen in the pilot still fail (parseBool trim only)', async () => {
  const dir = workspace(auditTask);
  try {
    cpSync(join(auditTask, 'fixtures/correct/lib'), join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib/parseBool.ts'), readFileSync(join(auditTask, 'public/lib/parseBool.ts'), 'utf8').replace('s.toLowerCase()', 's.trim().toLowerCase()'));
    const scored = await scoreTask(auditTask, dir);
    assert.equal(scored.passed, false);
    assert.equal(scored.reason, 'task_fail');
  } finally { cleanup(dir); }
});

test('doc-audit: deleting a lib file is parse_failure, not task_fail', async () => {
  const dir = workspace(auditTask);
  try {
    rmSync(join(dir, 'lib/median.ts'));
    assert.equal((await scoreTask(auditTask, dir)).reason, 'parse_failure');
  } finally { cleanup(dir); }
});
